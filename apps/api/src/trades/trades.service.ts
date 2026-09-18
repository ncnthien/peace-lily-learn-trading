import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Trade } from '@workspace/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  ORDER_EXECUTION,
  type OrderExecution,
} from '../order-execution/order-execution.types.js';

/**
 * TradeHistoryService (NCN-19).
 *
 * Subscribes to OrderExecution fills for every demo account on startup,
 * writes a `Trade` row to the append-only ledger for each fill, and
 * serves `list(accountId)` for the HTTP endpoint.
 *
 * Source discriminator (`Trade.automationItemId`):
 *   - defined  → fill was triggered by an AutomationItem
 *   - undefined → fill was manual (future NCN-16 manual endpoint)
 *
 * Re-subscribes for new demo accounts as they appear via a small
 * polling loop — accounts are rare so we don't need an event bus.
 */
@Injectable()
export class TradesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TradesService.name);
  private readonly subscriptions = new Map<string, () => void>();
  private pollHandle: NodeJS.Timeout | undefined;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ORDER_EXECUTION)
    private readonly orderExecution: OrderExecution,
  ) {}

  /**
   * On boot: subscribe to OrderExecution for every existing demo
   * account, then poll every 5s for new ones.
   */
  async onModuleInit(): Promise<void> {
    await this.refreshSubscriptions();
    this.pollHandle = setInterval(() => {
      void this.refreshSubscriptions().catch((err) => {
        this.logger.error(`refreshSubscriptions failed: ${String(err)}`);
      });
    }, 5_000);
    // `unref()` so the timer doesn't keep the process alive on shutdown.
    this.pollHandle.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pollHandle !== undefined) clearInterval(this.pollHandle);
    for (const unsub of this.subscriptions.values()) unsub();
    this.subscriptions.clear();
  }

  /**
   * List trades for an account, newest first. No pagination yet — the
   * append-only ledger is expected to stay small per account (one row
   * per fill). Add cursor-based pagination when volume warrants it.
   */
  async list(accountId: string): Promise<Trade[]> {
    const rows = await this.prisma.trade.findMany({
      where: { accountId },
      orderBy: { timestamp: 'desc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  /**
   * Idempotently subscribe to OrderExecution for every demo account
   * the database currently knows about. New demo accounts picked up
   * by the poll loop.
   */
  private async refreshSubscriptions(): Promise<void> {
    const demoAccounts = await this.prisma.account.findMany({
      where: { type: 'demo' },
      select: { id: true },
    });
    for (const acc of demoAccounts) {
      if (this.subscriptions.has(acc.id)) continue;
      const unsub = this.orderExecution.subscribe(
        { accountId: acc.id },
        (event) => {
          if (event.kind === 'filled') {
            void this.recordFill(event.order).catch((err) => {
              this.logger.error(
                `Failed to record fill for ${acc.id}: ${String(err)}`,
              );
            });
          }
        },
      );
      this.subscriptions.set(acc.id, unsub);
    }
  }

  /**
   * Write one Trade row for a filled order. Idempotent against the
   * `id` (Prisma's UUID PK prevents duplicates). Failures are logged
   * and swallowed so a transient DB blip doesn't kill the listener.
   */
  private async recordFill(order: {
    id: string;
    accountId: string;
    symbol: string;
    side: string;
    qty: number;
    filledPrice?: number;
    filledAt?: string;
    fee?: number;
    automationItemId?: string;
  }): Promise<void> {
    if (order.filledPrice === undefined || order.filledAt === undefined) {
      // Defensive — `filled` events should always have these.
      this.logger.warn(
        `fill event missing price/at for order ${order.id}; skipping`,
      );
      return;
    }
    await this.prisma.trade.create({
      data: {
        id: order.id,
        accountId: order.accountId,
        symbol: order.symbol,
        side: order.side,
        price: order.filledPrice,
        qty: order.qty,
        fee: order.fee ?? null,
        timestamp: new Date(order.filledAt),
        automationItemId: order.automationItemId ?? null,
      },
    });
  }

  private toDto(row: {
    id: string;
    accountId: string;
    symbol: string;
    side: string;
    price: number;
    qty: number;
    fee: number | null;
    timestamp: Date;
    automationItemId: string | null;
  }): Trade {
    return {
      id: row.id,
      accountId: row.accountId,
      symbol: row.symbol,
      side: row.side as Trade['side'],
      price: row.price,
      qty: row.qty,
      fee: row.fee ?? undefined,
      timestamp: row.timestamp.toISOString(),
      automationItemId: row.automationItemId ?? undefined,
    };
  }
}
