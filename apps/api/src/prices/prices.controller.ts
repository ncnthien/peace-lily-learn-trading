import { Controller, Get, Query } from '@nestjs/common';
import type { Timeframe } from '@workspace/shared';
import { BinanceService } from '../binance/binance.service.js';
import {
  normalizeInterval,
  normalizeLimit,
  normalizeSymbol,
  normalizeTime,
} from '../common/klines-query.js';

@Controller('prices')
export class PricesController {
  constructor(private readonly binance: BinanceService) {}

  @Get('klines')
  getKlines(
    @Query('symbol') symbol?: string,
    @Query('interval') interval?: Timeframe,
    @Query('limit') limit?: string,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
  ) {
    return this.binance.getKlines(
      normalizeSymbol(symbol),
      normalizeInterval(interval),
      normalizeLimit(limit),
      normalizeTime(startTime),
      normalizeTime(endTime),
    );
  }

  @Get('ticker')
  async getTicker(@Query('symbol') symbol?: string) {
    const sym = normalizeSymbol(symbol);
    return { symbol: sym, price: await this.binance.getPrice(sym) };
  }
}
