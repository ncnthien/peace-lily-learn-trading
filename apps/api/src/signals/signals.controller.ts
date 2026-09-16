import { Controller, Get, Query } from '@nestjs/common';
import type { Timeframe } from '@workspace/shared';
import { Timeframe as TimeframeValues } from '@workspace/shared';
import { BinanceService } from '../binance/binance.service.js';
import { SignalsService } from './signals.service.js';

@Controller('signals')
export class SignalsController {
  constructor(
    private readonly binance: BinanceService,
    private readonly signals: SignalsService,
  ) {}

  @Get('latest')
  async getLatest(
    @Query('symbol') symbol = 'BTCUSDT',
    @Query('interval') interval: Timeframe = TimeframeValues.ONE_HOUR,
    @Query('limit') limit = '200',
  ): Promise<ReturnType<SignalsService['evaluate']>> {
    const sym = symbol.trim().toUpperCase();
    const n = Math.min(Math.max(Number(limit) || 200, 50), 1000);
    const candles = await this.binance.getKlines(sym, interval, n);
    return this.signals.evaluate(sym, interval, candles);
  }
}
