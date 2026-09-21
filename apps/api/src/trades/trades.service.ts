import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type {
  Trade,
  TradeHistoryPage,
  TradeHistoryRow,
  TradeListFilters,
} from '@workspace/shared';
import { TRADE_HISTORY_MAX_LIMIT } from '@workspace/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  ORDER_EXECUTION,
  type OrderExecution,
} from '../order-execution/order-execution.types.js';
import { matchRealizedPnl } from '../pnl/fifo.js';

/**
 * TradeHistoryService (NCN-19 + NCN-23).
 *
 * Two responsibilities:
 *   1. Subscribe to OrderExecution fills for every demo account on
 *      startup and write a `Trade` row per fill (NCN-19). Source
 *      discriminator is `Trade.automationItemId` (defined → automation,
 *      undefined → manual).
 *   2. Serve the filterable + paginated history list (NCN-23). The
 *      paginated list attaches a `realizedPnl` per row, derived by
 *      re-running the FIFO matcher over the requested account's full
 *      ledger — same source of truth as `/pnl/realized`, so the row
 *      total can never drift from the realized-PnL endpoint.
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
   * Plain (legacy) list — newest-first, no filters, no pagination,
   * no per-row PnL. Kept for the existing `/trades?accountId=`
   * callers; the richer NCN-23 list lives at `listPage(...)`.
   */
  async list(accountId: string): Promise<Trade[]> {
    const rows = await this.prisma.trade.findMany({
      where: { accountId },
      orderBy: { timestamp: 'desc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  /**
   * Filterable + paginated history (NCN-23). The cursor is the last
   * row's `id` (a UUID); we sort by `(timestamp desc, id desc)` so the
   * cursor is stable even when two trades share the same timestamp.
   *
   * Pagination uses the "fetch one extra" trick: we ask for
   * `limit + 1` and, if we get the extra row, slice it off and emit
   * its `id` as `nextCursor`. When we don't get the extra row,
   * `nextCursor` is `null` (no more pages).
   *
   * Per-row PnL comes from re-running the FIFO matcher on the
   * account's full ledger (the matcher is O(n) and n is small per
   * account). We attach `realizedPnl` to sells that closed ≥ 1 unit;
   * buys and unmatched sells get `null`.
   */
  async listPage(
    filters: TradeListFilters,
    cursor: string | null,
    limit: number,
  ): Promise<TradeHistoryPage> {
    const take = Math.min(Math.max(limit, 1), TRADE_HISTORY_MAX_LIMIT) + 1;
    const where = this.buildWhere(filters, cursor);
    const rows = await this.prisma.trade.findMany({
      where,
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      take,
    });

    let nextCursor: string | null = null;
    let pageRows = rows;
    if (rows.length === take) {
      // The +1 row is the first row of the next page.
      pageRows = rows.slice(0, take - 1);
      nextCursor = pageRows[pageRows.length - 1]!.id;
    }

    // Realized PnL is computed at the *account* level — once per call,
    // keyed by the trade's `accountId` so the cache survives for
    // multi-account filters. Symbol-scoped FIFO walk inside each acct.
    const pnlByTradeId = await this.attachPnl(pageRows);

    return {
      items: pageRows.map((r) => this.toHistoryDto(r, pnlByTradeId.get(r.id) ?? null)),
      nextCursor,
    };
  }

  // ----- internals -----

  private buildWhere(
    filters: TradeListFilters,
    cursor: string | null,
  ): {
    accountId?: string;
    automationItemId?: string | { not: null } | null;
    timestamp?: { gte?: Date; lt?: Date };
    id?: { lt?: string };
  } {
    const where: ReturnType<TradesService['buildWhere']> = {};
    if (filters.accountId !== undefined) where.accountId = filters.accountId;
    if (filters.from !== undefined || filters.to !== undefined) {
      where.timestamp = {};
      if (filters.from !== undefined) where.timestamp.gte = new Date(filters.from);
      if (filters.to !== undefined) where.timestamp.lt = new Date(filters.to);
    }
    const source = filters.source;
    if (source !== undefined) {
      if (source === 'manual') {
        // Match the absence of automationItemId.
        where.automationItemId = null;
      } else if (source === 'automation') {
        // Any non-null item id.
        where.automationItemId = { not: null };
      } else {
        // Anything else is treated as an automationItemId literal.
        where.automationItemId = source;
      }
    }
    if (cursor !== null) {
      // Cursor tie-breaks inside the same timestamp by id. Sort is
      // (timestamp desc, id desc), so the cursor row's *next* page
      // contains items with `id < cursor.id` (lexicographic).
      where.id = { lt: cursor };
    }
    return where;
  }

  /**
   * Run the FIFO matcher per account covered by `rows` and produce a
   * map from `sellTradeId → realizedPnl`. Rows for accounts with no
   * sells (or no trades at all) get an empty map and silently fall
   * through to `null`.
   */
  private async attachPnl(
    rows: { id: string; accountId: string }[],
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (rows.length === 0) return out;

    // Group rows by accountId so we only run the matcher once per
    // distinct account (rows are already newest-first within an account
    // thanks to `(timestamp desc, id desc)` — but the FIFO matcher needs
    // ascending, hence the per-account re-sort below).
    const accountIds = Array.from(new Set(rows.map((r) => r.accountId)));
    await Promise.all(
      accountIds.map(async (accountId) => {
        const trades = await this.prisma.trade.findMany({
          where: { accountId },
          orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            symbol: true,
            side: true,
            price: true,
            qty: true,
            fee: true,
            timestamp: true,
          },
        });
        const fifoInput = trades.map((t) => ({
          id: t.id,
          symbol: t.symbol,
          side: t.side as 'buy' | 'sell',
          price: t.price,
          qty: t.qty,
          fee: t.fee,
          timestamp: t.timestamp.toISOString(),
        }));
        const matches = matchRealizedPnl(fifoInput, { logger: this });
        for (const m of matches) {
          // If a sell closes multiple times across the ledger, the
          // matcher emits one match per sell id with the *cumulative*
          // realized for that sell (sum across multiple matchedBuys).
          // We pick the last one written, which is the cumulative figure.
          out.set(m.sellTradeId, m.realizedPnl);
        }
      }),
    );
    return out;
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

  private toHistoryDto(
    row: {
      id: string;
      accountId: string;
      symbol: string;
      side: string;
      price: number;
      qty: number;
      fee: number | null;
      timestamp: Date;
      automationItemId: string | null;
    },
    realizedPnl: number | null,
  ): TradeHistoryRow {
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
      realizedPnl,
    };
  }

  // ---- FifoLogger adapter ----
  warn(msg: string): void {
    this.logger.warn(msg);
  }
}
