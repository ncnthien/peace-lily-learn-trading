import { Injectable } from '@nestjs/common';
import { EMA, RSI, WMA } from 'trading-signals';
import type {
  Candle,
  EmaCrossoverResult,
  RsiResult,
  SupportResistanceResult,
  WmaResult,
} from '@workspace/shared';
import {
  SR_DEFAULTS,
  detectSRZones,
  type SRDetectorOptions,
} from './sr-detector.js';

export const RSI_PERIOD = 14;
export const EMA_FAST_PERIOD = 9;
export const EMA_SLOW_PERIOD = 21;
export const WMA_PERIOD = 45;
export const RSI_EMA_PERIOD = 9;
export const RSI_WMA_PERIOD = 45;
export const SR_PIVOT_LEFT_BARS = SR_DEFAULTS.leftBars;
export const SR_PIVOT_RIGHT_BARS = SR_DEFAULTS.rightBars;
export const SR_CLUSTER_THRESHOLD_PCT = SR_DEFAULTS.thresholdPct;
export const SR_MAX_LEVELS = SR_DEFAULTS.maxLevels;

type MovingAverageConstructor = new (
  period: number,
) => {
  updates(inputs: readonly number[], replace?: boolean): (number | null)[];
};

@Injectable()
export class IndicatorsService {
  /** RSI value for every close — null until enough data (aligned with input) */
  rsiSeries(closes: number[], period = RSI_PERIOD): (number | null)[] {
    const indicator = new RSI(period);
    return indicator.updates(closes);
  }

  /** EMA value for every close — null until enough data (aligned with input) */
  emaSeries(closes: number[], period: number): (number | null)[] {
    const indicator = new EMA(period);
    return indicator.updates(closes);
  }

  /** WMA value for every close — null until enough data (aligned with input) */
  wmaSeries(closes: number[], period = WMA_PERIOD): (number | null)[] {
    const indicator = new WMA(period);
    return indicator.updates(closes);
  }

  /** Moving average of an already-computed series (e.g. EMA/WMA of RSI), aligned with input */
  smoothSeries(
    values: (number | null)[],
    MovingAverage: MovingAverageConstructor,
    period: number,
  ): (number | null)[] {
    const valid: number[] = [];
    const positions: number[] = [];
    values.forEach((v, i) => {
      if (v !== null) {
        valid.push(v);
        positions.push(i);
      }
    });
    const out: (number | null)[] = new Array<number | null>(values.length).fill(null);
    const results = new MovingAverage(period).updates(valid);
    positions.forEach((pos, j) => {
      out[pos] = results[j];
    });
    return out;
  }

  emaOfRsiSeries(rsiValues: (number | null)[], period = RSI_EMA_PERIOD): (number | null)[] {
    return this.smoothSeries(rsiValues, EMA, period);
  }

  wmaOfRsiSeries(rsiValues: (number | null)[], period = RSI_WMA_PERIOD): (number | null)[] {
    return this.smoothSeries(rsiValues, WMA, period);
  }

  rsi(closes: number[], period = RSI_PERIOD): RsiResult {
    return { value: this.rsiSeries(closes, period).at(-1) ?? null };
  }

  wma(closes: number[], period = WMA_PERIOD): WmaResult {
    return { value: this.wmaSeries(closes, period).at(-1) ?? null };
  }

  /**
   * Auto-detected support/resistance: pivot highs/lows (a bar whose high/low is
   * the extreme within left+right bars) clustered into levels within
   * thresholdPct of each other. Strength = number of touches.
   *
   * Thin delegate to {@link detectSRZones} so the same algorithm is reused
   * by the Automation `supportResistance` input provider (NCN-14). The
   * HTTP endpoint exposes the same shape and behavior as before.
   */
  supportResistance(candles: Candle[], options: SRDetectorOptions = {}): SupportResistanceResult {
    return detectSRZones(candles, options);
  }

  emaCrossover(closes: number[], fastPeriod = EMA_FAST_PERIOD, slowPeriod = EMA_SLOW_PERIOD): EmaCrossoverResult {
    if (closes.length < slowPeriod + 1) {
      return { fast: null, slow: null, crossed: null };
    }
    const fastSeries = this.emaSeries(closes, fastPeriod);
    const slowSeries = this.emaSeries(closes, slowPeriod);
    const fast = fastSeries.at(-1) ?? null;
    const slow = slowSeries.at(-1) ?? null;
    const prevFast = fastSeries.at(-2) ?? null;
    const prevSlow = slowSeries.at(-2) ?? null;
    if (fast === null || slow === null || prevFast === null || prevSlow === null) {
      return { fast, slow, crossed: null };
    }
    let crossed: 'up' | 'down' | null = null;
    if (prevFast <= prevSlow && fast > slow) crossed = 'up';
    else if (prevFast >= prevSlow && fast < slow) crossed = 'down';
    return { fast, slow, crossed };
  }
}
