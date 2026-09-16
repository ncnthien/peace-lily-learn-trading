import { Injectable } from '@nestjs/common';
import type { Candle, Signal, SignalDecision, Timeframe } from '@workspace/shared';
import { Signal as SignalValues } from '@workspace/shared';
import { IndicatorsService } from '../indicators/indicators.service.js';

@Injectable()
export class SignalsService {
  constructor(private readonly indicators: IndicatorsService) {}

  evaluate(symbol: string, interval: Timeframe, candles: Candle[]): SignalDecision {
    const closes = candles.map((c) => c.close);
    const rsi = this.indicators.rsi(closes);
    const emaCrossover = this.indicators.emaCrossover(closes);
    const wma = this.indicators.wma(closes);
    const price = closes.at(-1) ?? 0;

    // TODO: replace these placeholder rules with your own strategy
    let signal: Signal = SignalValues.HOLD;
    const reasons: string[] = [];

    if (rsi.value !== null && rsi.value < 30) {
      signal = SignalValues.BUY;
      reasons.push(`RSI ${rsi.value.toFixed(2)} < 30 (oversold)`);
    } else if (rsi.value !== null && rsi.value > 70) {
      signal = SignalValues.SELL;
      reasons.push(`RSI ${rsi.value.toFixed(2)} > 70 (overbought)`);
    }

    if (emaCrossover.crossed === 'up') {
      signal = SignalValues.BUY;
      reasons.push('EMA 9/21 bullish crossover');
    } else if (emaCrossover.crossed === 'down') {
      signal = SignalValues.SELL;
      reasons.push('EMA 9/21 bearish crossover');
    }

    return {
      symbol,
      interval,
      signal,
      price,
      evaluatedAt: new Date().toISOString(),
      indicators: { rsi, emaCrossover, wma },
      reason: reasons.length > 0 ? reasons.join('; ') : 'No actionable conditions',
    };
  }
}
