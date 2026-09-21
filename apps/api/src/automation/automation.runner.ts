import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type {
  AutomationAction,
  AutomationInput,
  ConditionNode,
  EvalContext,
  NormalizedSignal,
  RunOutcome,
} from '@workspace/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { ActionExecutor } from './action-executor.js';
import { ProviderRegistry } from './providers/provider.registry.js';
import { ConditionEvaluator } from './rule-engine/condition.evaluator.js';

/**
 * Number of consecutive errors before an item is auto-paused. Reset to
 * zero on any non-error tick (fired or skipped), and reset manually
 * whenever the user flips the item back to 'enabled' from the UI.
 */
const AUTO_PAUSE_THRESHOLD = 3;

/**
 * Runtime loop that turns AutomationItem rows into actual orders.
 *
 * Pipeline per tick (one minute):
 *   1. Load all enabled items whose input provider is registered.
 *   2. For each: provider.evaluate → provider.normalize → EvalContext.
 *   3. ConditionEvaluator walks the item's condition tree against the
 *      EvalContext. If it holds, we execute the action via
 *      ActionExecutor (which dispatches to OrderExecution.placeOrder).
 *
 * NCN-17 additions:
 *   - One AutomationRun row is written per item per tick (regardless
 *     of outcome).
 *   - A per-item consecutive-error counter ticks up on error ticks and
 *     resets on any non-error tick. Once it crosses AUTO_PAUSE_THRESHOLD,
 *     the item is auto-paused (status flips to 'paused') so the runner
 *     stops touching it on subsequent ticks. The user re-enables it
 *     manually, which also resets the counter.
 */
@Injectable()
export class AutomationRunner {
  private readonly logger = new Logger(AutomationRunner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProviderRegistry,
    private readonly conditionEvaluator: ConditionEvaluator,
    private readonly actionExecutor: ActionExecutor,
  ) {}

  /**
   * Cron-decorated tick. Runs every minute on the minute in the server's
   * local timezone (matches the rest of the @nestjs/schedule cron jobs).
   */
  @Cron('* * * * *')
  async onCronTick(): Promise<void> {
    await this.runOnce();
  }

  /**
   * Single tick — exposed publicly so tests can drive the loop without
   * waiting on a real cron. Returns a small summary the runner logs and
   * tests assert against.
   */
  async runOnce(now: number = Date.now()): Promise<RunSummary> {
    const items = await this.prisma.automationItem.findMany({
      where: { status: 'enabled' },
    });
    const summary: RunSummary = { considered: items.length, fired: 0, skipped: 0, errors: 0 };

    for (const item of items) {
      try {
        const result = await this.runItem(item, now);
        await this.recordOutcome(item.id, result.outcome, result.message, now);
        if (result.outcome === 'fired') summary.fired += 1;
        else if (result.outcome === 'skipped') summary.skipped += 1;
        else summary.errors += 1;
      } catch (err) {
        summary.errors += 1;
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to run item ${item.id}: ${message}`);
        // Record the error AND let the auto-pause counter see it. We
        // swallow the recorder's failure too — losing a log row
        // shouldn't take down the runner.
        await this.recordOutcome(item.id, 'error', message, now).catch((e) =>
          this.logger.error(`Failed to record run outcome: ${String(e)}`),
        );
      }
    }
    if (summary.fired > 0 || summary.errors > 0) {
      this.logger.log(
        `Tick @ ${new Date(now).toISOString()}: ${summary.fired} fired / ${summary.skipped} skipped / ${summary.errors} errors (out of ${summary.considered})`,
      );
    }
    return summary;
  }

  /**
   * Per-item run path. Returns a discriminated union so the caller can
   * decide how to log / count. Throws propagate as before — the outer
   * try/catch in `runOnce` records them as 'error'.
   */
  private async runItem(
    row: ItemRow,
    now: number,
  ): Promise<{ outcome: RunOutcome; message?: string }> {
    const input = row.input as AutomationInput;
    const provider = this.providers.get(input.kind);
    if (provider === undefined) {
      return {
        outcome: 'skipped',
        message: `no provider registered for kind "${input.kind}"`,
      };
    }
    const config = provider.validateConfig(input);
    const rawSignal = await provider.evaluate({ config, now, symbol: undefined, timeframe: undefined });
    if (rawSignal === null) {
      return { outcome: 'skipped', message: 'provider returned null' };
    }
    const normalized = provider.normalize(rawSignal, { now });
    const signals: NormalizedSignal[] = Array.isArray(normalized)
      ? normalized
      : [normalized];
    const ctx: EvalContext = { signals, now };
    const holds = this.conditionEvaluator.evaluate(
      row.condition as ConditionNode,
      ctx,
    );
    if (!holds) {
      return { outcome: 'skipped', message: 'condition did not hold' };
    }
    const action = row.action as AutomationAction;
    const result = await this.actionExecutor.execute(action, {
      accountId: row.accountId,
      automationItemId: row.id,
    });
    if (result.kind === 'no-order') {
      return {
        outcome: 'skipped',
        message: `action "${action.kind}" produced no order`,
      };
    }
    return { outcome: 'fired', message: `placed order ${result.order.id}` };
  }

  /**
   * Append a row to the AutomationRun log and update the per-item
   * consecutive-error counter. On error ticks, the counter ticks up;
   * otherwise it resets to zero. When the counter crosses the auto-pause
   * threshold, the item flips to 'paused' (and the counter is preserved,
   * so the user sees the reason in the log).
   */
  private async recordOutcome(
    itemId: string,
    outcome: RunOutcome,
    message: string | undefined,
    ranAt: number,
  ): Promise<void> {
    await this.prisma.automationRun.create({
      data: {
        automationItemId: itemId,
        outcome,
        message: message ?? null,
        ranAt: BigInt(ranAt),
      },
    });

    if (outcome === 'error') {
      // Atomic increment + auto-pause check.
      const updated = await this.prisma.automationItem.update({
        where: { id: itemId },
        data: { consecutiveErrors: { increment: 1 } },
        select: { id: true, consecutiveErrors: true, status: true, name: true },
      });
      if (
        updated.status === 'enabled' &&
        updated.consecutiveErrors >= AUTO_PAUSE_THRESHOLD
      ) {
        await this.prisma.automationItem.update({
          where: { id: itemId },
          data: { status: 'paused' },
        });
        this.logger.warn(
          `Item ${itemId} auto-paused after ${updated.consecutiveErrors} consecutive errors`,
        );
      }
    } else {
      // Reset the counter on any non-error tick so a transient blip
      // doesn't keep accumulating.
      await this.prisma.automationItem.updateMany({
        where: { id: itemId, consecutiveErrors: { gt: 0 } },
        data: { consecutiveErrors: 0 },
      });
    }
  }
}

export interface RunSummary {
  considered: number;
  fired: number;
  skipped: number;
  errors: number;
}

/** Minimal shape we read from a Prisma AutomationItem row. */
interface ItemRow {
  id: string;
  accountId: string;
  input: unknown;
  condition: unknown;
  action: unknown;
}