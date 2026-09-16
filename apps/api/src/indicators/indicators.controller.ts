import { Controller, Get, Query } from '@nestjs/common';
import type { CandleWithIndicators, Timeframe } from '@workspace/shared';
import { BinanceService } from '../binance/binance.service.js';
import {
  normalizeInterval,
  normalizeLimit,
  normalizeSymbol,
  normalizeTime,
} from '../common/klines-query.js';
import {
  IndicatorsService,
  RSI_EMA_PERIOD,
  RSI_PERIOD,
  RSI_WMA_PERIOD,
} from './indicators.service.js';

@Controller('indicators')
export class IndicatorsController {
  constructor(
    private readonly binance: BinanceService,
    private readonly indicators: IndicatorsService,
  ) {}

  @Get('candles')
  async getCandles(
    @Query('symbol') symbol?: string,
    @Query('interval') interval?: Timeframe,
    @Query('limit') limit?: string,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
  ): Promise<CandleWithIndicators[]> {
    const candles = await this.binance.getKlines(
      normalizeSymbol(symbol),
      normalizeInterval(interval),
      normalizeLimit(limit),
      normalizeTime(startTime),
      normalizeTime(endTime),
    );
    const closes = candles.map((c) => c.close);
    const rsi = this.indicators.rsiSeries(closes, RSI_PERIOD);
    const emaRsi = this.indicators.emaOfRsiSeries(rsi, RSI_EMA_PERIOD);
    const wmaRsi = this.indicators.wmaOfRsiSeries(rsi, RSI_WMA_PERIOD);
    return candles.map((candle, i) => ({
      ...candle,
      rsi: rsi[i] ?? null,
      emaRsi: emaRsi[i] ?? null,
      wmaRsi: wmaRsi[i] ?? null,
    }));
  }

  @Get('levels')
  async getLevels(
    @Query('symbol') symbol?: string,
    @Query('interval') interval?: Timeframe,
    @Query('limit') limit?: string,
  ) {
    const candles = await this.binance.getKlines(
      normalizeSymbol(symbol),
      normalizeInterval(interval),
      normalizeLimit(limit, 500),
    );
    return this.indicators.supportResistance(candles);
  }
}
