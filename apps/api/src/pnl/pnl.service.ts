import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  PnlBucket,
  PnlBucketPoint,
  RealizedPnlMatch,
  RealizedPnlSummary,
  UnrealizedPnlSummary,
  UnrealizedPosition,
} from '@workspace/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  MARKET_DATA_SOURCE,
  type MarketDataSource,
} from '../market-data/market-data.types.js';
import { bucketRealizedPnl } from './bucket.js';
import { matchRealizedPnl } from './fifo.js';
import { computeOpenPositions } from './unrealized.js';

/**
 * PnlService (NCN-20 + NCN-21).
 *
 * Realized PnL is computed on-demand from the Trade ledger (NCN-19). No
 * separate persistence: the FIFO matcher is deterministic, the ledger is
 * append-only, and re-running on every request keeps the result correct
 * without bookkeeping for retroactive corrections.
 *
 * Unrealized PnL (NCN-21) walks the same ledger to derive the open
 * positions still on the books, then marks each to its most recent
 * observed price from MarketDataSource. The endpoint is fresh-on-request
 * ("near real-time" in the ticket sense); the underlying Binance source
 * caches the latest price between REST polls, so consecutive calls inside
 * the cache window are cheap.
 *
 * Scope: long-only. Shorts are out of scope for the demo flow; a sell
 * that exceeds the open position is clamped inside the matcher with a
 * warning logged to the Nest logger.
 */
@Injectable()
export class PnlService {
  private readonly logger = new Logger(PnlService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MARKET_DATA_SOURCE)
    private readonly marketData: MarketDataSource,
  ) {}

  /**
   * Per-trade breakdown: one entry per sell that closed ≥ 1 unit, in
   * chronological order. Useful for an "audit trail" view in the UI.
   */
  async listMatches(accountId: string): Promise<RealizedPnlMatch[]> {
    const trades = await this.loadTrades(accountId);
    return matchRealizedPnl(trades, { logger: this });
  }

  /**
   * Aggregated summary for an account: total realized PnL, per-symbol
   * breakdown, and the underlying matches so they don't need a second
   * round-trip.
   */
  async getSummary(accountId: string): Promise<RealizedPnlSummary> {
    const trades = await this.loadTrades(accountId);
    const matches = matchRealizedPnl(trades, { logger: this });

    let totalRealizedPnl = 0;
    const perSymbol: Record<string, number> = {};
    for (const m of matches) {
      totalRealizedPnl += m.realizedPnl;
      perSymbol[m.symbol] = (perSymbol[m.symbol] ?? 0) + m.realizedPnl;
    }

    return { accountId, totalRealizedPnl, perSymbol, matches };
  }

  /**
   * Adapter: load trades ascending so the FIFO matcher can walk them
   * in fill order. Null `fee` is normalized to 0 inside the matcher
   * via {@link unitFee}.
   */
  private async loadTrades(accountId: string) {
    const rows = await this.prisma.trade.findMany({
      where: { accountId },
      orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      symbol: r.symbol,
      side: r.side as 'buy' | 'sell',
      price: r.price,
      qty: r.qty,
      fee: r.fee,
      timestamp: r.timestamp.toISOString(),
    }));
  }

  // FifoLogger adapter — only `.warn` is used by the matcher.
  warn(msg: string): void {
    this.logger.warn(msg);
  }

  /**
   * Per-account aggregate: total unrealized PnL across all open
   * positions, plus a per-symbol breakdown and the underlying position
   * list. Symbols where the MarketDataSource returned no price are
   * included with `markPrice: null` and `unrealizedPnl: null` rather
   * than dropped — the UI distinguishes "I couldn't get a price" from
   * "the price gives me zero PnL".
   */
  async getUnrealizedSummary(accountId: string): Promise<UnrealizedPnlSummary> {
    const positions = await this.getUnrealizedPositions(accountId);
    let totalUnrealizedPnl = 0;
    const perSymbol: Record<string, number> = {};
    for (const position of positions) {
      if (position.unrealizedPnl === null) continue;
      totalUnrealizedPnl += position.unrealizedPnl;
      perSymbol[position.symbol] = (perSymbol[position.symbol] ?? 0) + position.unrealizedPnl;
    }
    return { accountId, totalUnrealizedPnl, perSymbol, positions };
  }

  /**
   * Bucketed realized-PnL time series for the dashboard chart
   * (NCN-22). Reuses the FIFO matcher so the series stays consistent
   * with `/pnl/realized` totals — there is no second source of truth.
   * Sparse output: only buckets that contain at least one match are
   * returned.
   */
  async getPnlSeries(accountId: string, bucket: PnlBucket): Promise<PnlBucketPoint[]> {
    const trades = await this.loadTrades(accountId);
    const matches = matchRealizedPnl(trades, { logger: this });
    return bucketRealizedPnl(matches, bucket);
  }

  /**
   * Per-position snapshot: open positions for the account, derived from
   * the Trade ledger and priced against the latest observed MarketData
   * price for each symbol. The mark fetch runs in parallel across
   * symbols — Binance caches the response per symbol, so the cost is
   * roughly one HTTP round-trip per held symbol regardless of how
   * many positions share that symbol.
   */
  async getUnrealizedPositions(accountId: string): Promise<UnrealizedPosition[]> {
    const trades = await this.loadTrades(accountId);
    const open = computeOpenPositions(accountId, trades, { logger: this });
    if (open.length === 0) return open;

    // Fetch marks in parallel; tolerate `null` per-symbol (no quote yet).
    const symbols = Array.from(new Set(open.map((p) => p.symbol)));
    const marks = await Promise.all(
      symbols.map(async (symbol) => {
        const price = await this.marketData.getLatestPrice({ symbol });
        return { symbol, price };
      }),
    );
    const markBySymbol = new Map(marks.map((m) => [m.symbol, m.price]));

    return open.map((position) => {
      const mark = markBySymbol.get(position.symbol) ?? null;
      const unrealizedPnl =
        mark === null ? null : position.qty * (mark - position.avgEntryPrice);
      return {
        ...position,
        markPrice: mark,
        unrealizedPnl,
        // pricedAt tracks the moment the source observed the mark. The
        // MarketDataSource contract doesn't currently return a timestamp
        // for getLatestPrice, so we record "now" — close enough for the
        // UI to flag a stale mark when the user lingers on the page.
        pricedAt: mark === null ? null : new Date().toISOString(),
      };
    });
  }
}