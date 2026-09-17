import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { OrderEvent, Unsubscribe } from '@workspace/shared';
import { OrderStatus, TradeSide } from '@workspace/shared';
import { OrderExecution } from '../order-execution/order-execution.types.js';
import { ORDER_EXECUTION } from '../order-execution/order-execution.types.js';
import { PrismaService } from '../prisma/prisma.service.js';

const DEMO_TYPE = 'demo';

/**
 * Listens to demo-account order fill events and updates Account.balance in
 * the database. Demo accounts are paper-money: BUY deducts (price * qty)
 * from the balance, SELL adds it back. Insufficient-balance rejection is
 * intentionally NOT enforced here — paper trading allows overdraft for
 * testing strategies that would otherwise be rejected. Real broker impls
 * (NCN-10) will do balance checks before placing the order.
 *
 * Lifecycle:
 *   - On OnModuleInit: subscribes to every existing demo account's order
 *     event stream.
 *   - track(accountId) / untrack(accountId): called by AccountsService when
 *     a demo account is created / removed.
 *   - On OnModuleDestroy: detaches every active subscription.
 */
@Injectable()
export class DemoBalanceTracker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DemoBalanceTracker.name);
  private readonly unsubscribers = new Map<string, Unsubscribe>();

  constructor(
    @Inject(ORDER_EXECUTION) private readonly executions: OrderExecution,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.bootstrapExistingAccounts();
  }

  onModuleDestroy(): void {
    for (const unsub of this.unsubscribers.values()) unsub();
    this.unsubscribers.clear();
  }

  /** Subscribe to OrderExecution events for a single demo account. Idempotent. */
  track(accountId: string): void {
    if (this.unsubscribers.has(accountId)) return;
    const unsub = this.executions.subscribe({ accountId }, (event) => {
      void this.handleEvent(accountId, event);
    });
    this.unsubscribers.set(accountId, unsub);
  }

  /** Detach the subscription for a single demo account. Safe if not tracked. */
  untrack(accountId: string): void {
    const unsub = this.unsubscribers.get(accountId);
    if (unsub === undefined) return;
    unsub();
    this.unsubscribers.delete(accountId);
  }

  /** Internal: act on OrderEvents for a tracked account. */
  private async handleEvent(accountId: string, event: OrderEvent): Promise<void> {
    if (event.kind !== 'filled') return;
    if (event.order.accountId !== accountId) return;
    if (event.order.status !== OrderStatus.FILLED) return;
    if (event.order.filledPrice === undefined) return;

    const qty = event.order.qty;
    const price = event.order.filledPrice;
    const delta =
      event.order.side === TradeSide.BUY ? -(price * qty) : price * qty;

    try {
      await this.prisma.account.update({
        where: { id: accountId },
        data: { balance: { increment: delta } },
      });
    } catch (err) {
      // The account may have been deleted between the event and the update —
      // untrack to stop receiving events for it.
      this.logger.error(
        `Failed to apply fill for account ${accountId}: ${String(err)}`,
      );
      this.untrack(accountId);
    }
  }

  /** On startup, attach to every active demo account. */
  private async bootstrapExistingAccounts(): Promise<void> {
    const rows = await this.prisma.account.findMany({
      where: { type: DEMO_TYPE },
      select: { id: true },
    });
    for (const row of rows) this.track(row.id);
    if (rows.length > 0) {
      this.logger.log(
        `DemoBalanceTracker subscribed to ${rows.length} existing demo account(s)`,
      );
    }
  }
}
