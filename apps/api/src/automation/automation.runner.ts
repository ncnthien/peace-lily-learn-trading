import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type {
  AutomationAction,
  AutomationInput,
  ConditionNode,
  EvalContext,
  NormalizedSignal,
  PlaceOrderInput,
} from '@workspace/shared';
import { TradeSide } from '@workspace/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  ORDER_EXECUTION,
  type OrderExecution,
} from '../order-execution/order-execution.types.js';
import { ProviderRegistry } from './providers/provider.registry.js';
import { ConditionEvaluator } from './rule-engine/condition.evaluator.js';

/**
 * Runtime loop that turns AutomationItem rows into actual orders.
 *
 * Pipeline per tick (one minute):
 *   1. Load all enabled items whose input provider is registered
 *      (today: only `time`; future providers plug in here too).
 *   2. For each: provider.evaluate → provider.normalize → EvalContext.
 *   3. ConditionEvaluator walks the item's condition tree against the
 *      EvalContext. If it holds, we execute the action via
 *      OrderExecution.placeOrder.
 *
 * NCN-13 scope: `time` only. The runner is the one tick path; new
 * provider kinds will reuse this loop with their own signals. When more
 * than one provider is in scope for a tick, this loop will collect
 * signals from each before evaluating the tree — the architecture
 * already supports it via EvalContext.signals.
 */
@Injectable()
export class AutomationRunner {
  private readonly logger = new Logger(AutomationRunner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProviderRegistry,
    private readonly conditionEvaluator: ConditionEvaluator,
    @Inject(ORDER_EXECUTION)
    private readonly orderExecution: OrderExecution,
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
        if (result === 'fired') summary.fired += 1;
        else summary.skipped += 1;
      } catch (err) {
        summary.errors += 1;
        this.logger.error(
          `Failed to run item ${String((item as { id: string }).id)}: ${String(err)}`,
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

  private async runItem(
    row: ItemRow,
    now: number,
  ): Promise<'fired' | 'skipped'> {
    const input = row.input as AutomationInput;
    const provider = this.providers.get(input.kind);
    if (provider === undefined) {
      // No provider registered for this kind — skip silently. Future
      // providers will be registered before any item uses them.
      return 'skipped';
    }
    const config = provider.validateConfig(input);
    const rawSignal = await provider.evaluate({ config, now, symbol: undefined, timeframe: undefined });
    if (rawSignal === null) return 'skipped';
    const signal = provider.normalize(rawSignal, { now });
    const ctx: EvalContext = { signals: [signal satisfies NormalizedSignal], now };
    const holds = this.conditionEvaluator.evaluate(
      row.condition as ConditionNode,
      ctx,
    );
    if (!holds) return 'skipped';
    const action = row.action as AutomationAction;
    const placeInput = this.toPlaceOrderInput(action, row.accountId, row.id);
    if (placeInput === null) {
      this.logger.warn(
        `Item ${row.id} action is not an order placement; skipping`,
      );
      return 'skipped';
    }
    await this.orderExecution.placeOrder(placeInput);
    return 'fired';
  }

  /**
   * Map AutomationAction → OrderExecution.placeOrder input. `buy` and
   * `sell` actions translate to a single order; `notify`/`none` don't
   * produce an order (not handled by NCN-13).
   *
   * `automationItemId` is threaded through to the resulting Order so
   * TradeHistoryService can attribute the fill in the Trade ledger.
   */
  private toPlaceOrderInput(
    action: AutomationAction,
    accountId: string,
    automationItemId: string,
  ): PlaceOrderInput | null {
    if (action.kind === 'buy') {
      return { accountId, symbol: action.symbol, side: TradeSide.BUY, qty: action.qty, automationItemId };
    }
    if (action.kind === 'sell') {
      return { accountId, symbol: action.symbol, side: TradeSide.SELL, qty: action.qty, automationItemId };
    }
    return null;
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
