import {
  BadRequestException,
  Controller,
  Get,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import type {
  Trade,
  TradeHistoryPage,
  TradeListFilters,
} from '@workspace/shared';
import {
  TRADE_HISTORY_DEFAULT_LIMIT,
  TRADE_HISTORY_MAX_LIMIT,
} from '@workspace/shared';
import { TradesService } from './trades.service.js';

/**
 * Parse the `limit` query into a positive integer clamped to
 * `[1, TRADE_HISTORY_MAX_LIMIT]`. Defaults to
 * `TRADE_HISTORY_DEFAULT_LIMIT` when absent. Bad values → 400.
 */
function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return TRADE_HISTORY_DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new BadRequestException('limit must be a positive integer');
  }
  return Math.min(n, TRADE_HISTORY_MAX_LIMIT);
}

@Controller('trades')
export class TradesController {
  constructor(private readonly trades: TradesService) {}

  /**
   * GET /trades?accountId=<id>
   *
   * Legacy list endpoint kept for the NCN-19 simple call site — just
   * every trade for one account, newest first, no filters and no
   * per-row PnL. Use `GET /trades/page` (NCN-23) for the richer,
   * filterable, paginated view.
   */
  @Get()
  list(@Query('accountId') accountId?: string): Promise<Trade[]> {
    if (accountId === undefined || accountId.length === 0) {
      return Promise.resolve([]);
    }
    return this.trades.list(accountId);
  }

  /**
   * GET /trades/page?accountId=&from=&to=&source=&cursor=&limit=
   * (NCN-23).
   *
   * Filterable + paginated trade history. Filters:
   *   - `accountId` — restrict to one account (omit for all)
   *   - `from` / `to` — ISO date bounds (inclusive / exclusive)
   *   - `source` — `'manual'`, `'automation'`, or an
   *     automationItemId literal
   *
   * Pagination is cursor-based (`cursor=<last id>`), newest-first.
   * `limit` defaults to {@link TRADE_HISTORY_DEFAULT_LIMIT}, capped at
   * {@link TRADE_HISTORY_MAX_LIMIT}. Each row carries `realizedPnl`
   * (null for buys and unmatched sells).
   */
  @Get('page')
  async listPage(
    @Query('accountId') accountId: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('source') source: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('limit', new ParseIntPipe({ optional: true })) limitRaw?: number,
  ): Promise<TradeHistoryPage> {
    // parseLimit exists to lift the cap inline; if Nest parsed it
    // already, we just clamp.
    const limit =
      limitRaw !== undefined
        ? Math.min(Math.max(limitRaw, 1), TRADE_HISTORY_MAX_LIMIT)
        : parseLimit(undefined);
    const filters: TradeListFilters = {};
    if (accountId !== undefined && accountId.length > 0) filters.accountId = accountId;
    if (from !== undefined) {
      const fromMs = Date.parse(from);
      if (Number.isNaN(fromMs)) throw new BadRequestException('from must be a valid ISO date');
      filters.from = new Date(fromMs).toISOString();
    }
    if (to !== undefined) {
      const toMs = Date.parse(to);
      if (Number.isNaN(toMs)) throw new BadRequestException('to must be a valid ISO date');
      filters.to = new Date(toMs).toISOString();
    }
    if (source !== undefined && source.length > 0) filters.source = source;
    return this.trades.listPage(filters, cursor ?? null, limit);
  }
}
