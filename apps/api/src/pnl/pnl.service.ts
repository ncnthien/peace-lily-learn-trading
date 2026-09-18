import { Injectable, Logger } from '@nestjs/common';
import type {
  RealizedPnlMatch,
  RealizedPnlSummary,
} from '@workspace/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { matchRealizedPnl } from './fifo.js';

/**
 * PnlService (NCN-20).
 *
 * Computes realized PnL on-demand from the Trade ledger (NCN-19). No
 * separate persistence: the FIFO matcher is deterministic, the ledger is
 * append-only, and re-running on every request keeps the result correct
 * without bookkeeping for retroactive corrections.
 *
 * Scope: long-only. Shorts are out of scope for the demo flow; a sell
 * that exceeds the open position is clamped inside the matcher with a
 * warning logged to the Nest logger.
 */
@Injectable()
export class PnlService {
  private readonly logger = new Logger(PnlService.name);

  constructor(private readonly prisma: PrismaService) {}

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
}