import { Controller, Get, Query } from '@nestjs/common';
import { TradesService } from './trades.service.js';

@Controller('trades')
export class TradesController {
  constructor(private readonly trades: TradesService) {}

  /**
   * GET /trades?accountId=<id>
   * List trades for an account, newest first. Validation is light on
   * the query — the standard NestJS ValidationPipe (whitelist mode)
   * rejects any extra query keys.
   */
  @Get()
  list(@Query('accountId') accountId?: string) {
    if (accountId === undefined || accountId.length === 0) {
      return [];
    }
    return this.trades.list(accountId);
  }
}
