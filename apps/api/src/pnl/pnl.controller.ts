import { Controller, Get, Query } from '@nestjs/common';
import type {
  RealizedPnlMatch,
  RealizedPnlSummary,
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
}