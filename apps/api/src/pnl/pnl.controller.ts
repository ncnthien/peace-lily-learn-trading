import { Controller, Get, Query } from '@nestjs/common';
import type {
  RealizedPnlMatch,
  RealizedPnlSummary,
  UnrealizedPnlSummary,
  UnrealizedPosition,
} from '@workspace/shared';
import { PnlService } from './pnl.service.js';

@Controller('pnl')
export class PnlController {
  constructor(private readonly pnl: PnlService) {}

  /**
   * GET /pnl/realized?accountId=<id>
   *
   * Aggregated summary: totalRealizedPnl + perSymbol + the underlying
   * matches. Empty result when accountId is absent — matches the loose
   * query convention used by /trades and /automation.
   */
  @Get('realized')
  async getRealized(
    @Query('accountId') accountId?: string,
  ): Promise<RealizedPnlSummary | { accountId: ''; totalRealizedPnl: 0; perSymbol: {}; matches: [] }> {
    if (accountId === undefined || accountId.length === 0) {
      return { accountId: '', totalRealizedPnl: 0, perSymbol: {}, matches: [] };
    }
    return this.pnl.getSummary(accountId);
  }

  /**
   * GET /pnl/realized/trades?accountId=<id>
   *
   * Per-trade breakdown — one entry per sell that closed ≥ 1 unit.
   * Useful for the audit trail when the summary needs context.
   */
  @Get('realized/trades')
  async getRealizedTrades(
    @Query('accountId') accountId?: string,
  ): Promise<RealizedPnlMatch[]> {
    if (accountId === undefined || accountId.length === 0) {
      return [];
    }
    return this.pnl.listMatches(accountId);
  }

  /**
   * GET /pnl/unrealized?accountId=<id> (NCN-21)
   *
   * Aggregated unrealized PnL across all open positions for the account.
   * Mark-to-market against the latest price observed by MarketDataSource.
   * Empty result (zero total, empty positions, empty perSymbol) when
   * accountId is absent — mirrors the loose query convention.
   */
  @Get('unrealized')
  async getUnrealized(
    @Query('accountId') accountId?: string,
  ): Promise<UnrealizedPnlSummary | { accountId: ''; totalUnrealizedPnl: 0; perSymbol: {}; positions: [] }> {
    if (accountId === undefined || accountId.length === 0) {
      return { accountId: '', totalUnrealizedPnl: 0, perSymbol: {}, positions: [] };
    }
    return this.pnl.getUnrealizedSummary(accountId);
  }

  /**
   * GET /pnl/unrealized/positions?accountId=<id> (NCN-21)
   *
   * Per-position snapshot — one entry per held symbol with its mark,
   * avg cost, and unrealized PnL. Useful for the table view; the summary
   * endpoint already embeds this list so a second round-trip is only
   * worthwhile for clients that want *just* the rows.
   */
  @Get('unrealized/positions')
  async getUnrealizedPositions(
    @Query('accountId') accountId?: string,
  ): Promise<UnrealizedPosition[]> {
    if (accountId === undefined || accountId.length === 0) {
      return [];
    }
    return this.pnl.getUnrealizedPositions(accountId);
  }
}