import type { Candle, Timeframe } from '@workspace/shared';

/**
 * Wave detector (NCN-15).
 *
 * Pure function. Takes historical candles + options, returns a list of
 * wave segments extracted from RSI-vs-EMA-of-RSI crossovers.
 *
 * Algorithm:
 *
 *   1. **RSI series** (period 14 by default) over close prices.
 *   2. **Signal line** = EMA of RSI (period 9 by default).
 *   3. **Crossovers**: a bar `i` where `rsi[i-1] <= emaRsi[i-1]` and
 *      `rsi[i] > emaRsi[i]` is an upward (bullish) crossover; the
 *      opposite is downward. We emit a `WaveSegment` between
 *      consecutive crossovers.
 *   4. **Local high/low**: each wave carries the peak and trough of
 *      the underlying RSI between its start and end bars.
 *   5. **Noise filter**: waves whose peak-to-trough RSI span is less
 *      than `noiseThreshold` (default 5 RSI points) are dropped. This
 *      removes choppy micro-waves that would otherwise spam the runner.
 *
 * Output shape: array of `WaveSegment` with start/end indices, times,
 * RSI values, direction (up/down), phase, and the peak/trough RSI.
 *
 * Does NOT consult market data, look up live prices, or mutate its
 * input. Caller is responsible for fetching candles in ascending
 * openTime order (the standard shape coming out of MarketDataSource).
 *
 * Compatibility: matches the existing `rsiSeries` / `smoothSeries` /
 * `emaOfRsiSeries` return shapes in `IndicatorsService` — output
 * arrays are length-aligned with the input and `null` for the warm-up
 * bars. The provider layer adapts this to NormalizedSignal.
 */

export interface WaveSegment {
  /** Index of the start crossover bar (inclusive). */
  startIdx: number;
  /** Index of the end crossover bar (inclusive). */
  endIdx: number;
  /** Epoch ms (openTime) of the start bar. */
  startTime: number;
  /** Epoch ms (openTime) of the end bar. */
  endTime: number;
  /** Direction of the wave: 'up' if the segment went up, 'down' otherwise. */
  direction: 'up' | 'down';
  /** RSI at the start of the wave. */
  startRsi: number;
  /** RSI at the end of the wave. */
  endRsi: number;
  /** Peak RSI inside the wave. */
  peakRsi: number;
  /** Trough RSI inside the wave. */
  troughRsi: number;
  /**
   * Magnitude = max - min RSI within the wave. Used by the noise
   * filter; exposed so the caller can see what passed.
   */
  magnitude: number;
  /**
   * Lifecycle phase. For V1 every detected wave has both endpoints
   * (start + end crossover), so they read as 'exhausting'. The runner's
   * wave_phase_not leaf can match on this directly.
   */
  phase: 'developing' | 'exhausting';
}

export interface WaveDetectorOptions {
  /** RSI period (default 14). */
  rsiPeriod?: number;
  /** EMA period over RSI for the signal line (default 9). */
  emaPeriod?: number;
  /**
   * Minimum peak-to-trough RSI span (default 5). Waves whose
   * magnitude < threshold are dropped.
   */
  noiseThreshold?: number;
  /** Override the symbol/interval for source attribution. */
  symbol?: string;
  interval?: Timeframe;
}

export const WAVE_DEFAULTS = {
  rsiPeriod: 14,
  emaPeriod: 9,
  noiseThreshold: 5,
} as const;

/**
 * Single source of truth for the wave detector. Internal subroutines
 * are kept as named helpers for clarity and unit testing.
 */
export function detectWaves(
  closes: readonly number[],
  opens: readonly number[],
  options: WaveDetectorOptions = {},
): WaveSegment[] {
  const rsiPeriod = options.rsiPeriod ?? WAVE_DEFAULTS.rsiPeriod;
  const emaPeriod = options.emaPeriod ?? WAVE_DEFAULTS.emaPeriod;
  const noiseThreshold = options.noiseThreshold ?? WAVE_DEFAULTS.noiseThreshold;

  if (closes.length !== opens.length) {
    throw new Error('detectWaves: closes and opens must be the same length');
  }
  if (closes.length < rsiPeriod + emaPeriod + 1) {
    return [];
  }

  const rsiSeries = rsiSeriesFromCloses(closes, rsiPeriod);
  const emaRsiSeries = emaOfSeries(rsiSeries, emaPeriod);
  const crossoverIdx = findCrossovers(rsiSeries, emaRsiSeries);
  if (crossoverIdx.length < 2) {
    return [];
  }

  const segments: WaveSegment[] = [];
  for (let i = 0; i < crossoverIdx.length - 1; i++) {
    const start = crossoverIdx[i]!;
    const end = crossoverIdx[i + 1]!;
    const startRsi = rsiSeries[start]!;
    const endRsi = rsiSeries[end]!;
    const direction: 'up' | 'down' = endRsi > startRsi ? 'up' : 'down';

    let peak = -Infinity;
    let trough = Infinity;
    for (let j = start; j <= end; j++) {
      const v = rsiSeries[j]!;
      if (v > peak) peak = v;
      if (v < trough) trough = v;
    }
    const magnitude = peak - trough;
    if (magnitude < noiseThreshold) continue;

    segments.push({
      startIdx: start,
      endIdx: end,
      startTime: opens[start]!,
      endTime: opens[end]!,
      direction,
      startRsi,
      endRsi,
      peakRsi: peak,
      troughRsi: trough,
      magnitude,
      // Both endpoints known → wave is "exhausting" in the lifecycle sense.
      phase: 'exhausting',
    });
  }
  return segments;
}

/** Convenience wrapper: detect from candles directly. */
export function detectWavesFromCandles(
  candles: readonly Candle[],
  options: WaveDetectorOptions = {},
): WaveSegment[] {
  const closes = candles.map((c) => c.close);
  const opens = candles.map((c) => c.openTime);
  return detectWaves(closes, opens, options);
}

// ============================================================
// Internal helpers — extracted for unit testing + to mirror the
// existing IndicatorsService primitives so the provider layer can
// swap implementations if needed.
// ============================================================

/**
 * Wilder-style RSI over `closes`. Returns an array length-aligned with
 * the input; the first `period` elements are `null` (warm-up).
 *
 * This is the same algorithm `IndicatorsService.rsiSeries` uses via
 * `trading-signals`. Re-implemented here so the detector is testable
 * without spinning up NestJS.
 */
export function rsiSeriesFromCloses(
  closes: readonly number[],
  period: number,
): (number | null)[] {
  if (period <= 0) {
    throw new Error('rsiSeriesFromCloses: period must be > 0');
  }
  const out: (number | null)[] = new Array<number | null>(closes.length).fill(null);
  if (closes.length <= period) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i]! - closes[i - 1]!;
    if (change > 0) gainSum += change;
    else lossSum += -change;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/**
 * EMA over a numeric series. Nulls are skipped (same convention as
 * `IndicatorsService.smoothSeries`). Output length-aligned with input.
 */
export function emaOfSeries(
  values: readonly (number | null)[],
  period: number,
): (number | null)[] {
  if (period <= 0) throw new Error('emaOfSeries: period must be > 0');
  const out: (number | null)[] = Array.from({ length: values.length }, () => null);

  // Find the first contiguous run of valid values to seed the EMA.
  let start = -1;
  for (let i = 0; i < values.length; i++) {
    if (values[i] !== null) {
      start = i;
      break;
    }
  }
  if (start === -1) return out;

  // We need `period` consecutive valid values to emit the first EMA.
  let validRun = 0;
  let seed = 0;
  for (let i = start; i < values.length && validRun < period; i++) {
    if (values[i] === null) {
      validRun = 0;
      seed = 0;
      continue;
    }
    seed += values[i]!;
    validRun++;
  }
  if (validRun < period) return out;
  const seedEnd = start + period;
  let ema = seed / period;
  out[seedEnd - 1] = ema;
  const k = 2 / (period + 1);
  for (let i = seedEnd; i < values.length; i++) {
    const v = values[i];
    if (v === null) continue;
    ema = v * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

/**
 * Indices of bars where RSI crosses the EMA signal line. Strict
 * inequality (>) / (<) — equal values don't count as a crossover.
 */
export function findCrossovers(
  rsi: readonly (number | null)[],
  emaRsi: readonly (number | null)[],
): number[] {
  if (rsi.length !== emaRsi.length) {
    throw new Error('findCrossovers: arrays must be the same length');
  }
  const out: number[] = [];
  for (let i = 1; i < rsi.length; i++) {
    const prevR = rsi[i - 1];
    const prevE = emaRsi[i - 1];
    const currR = rsi[i];
    const currE = emaRsi[i];
    if (
      prevR === null ||
      prevR === undefined ||
      prevE === null ||
      prevE === undefined ||
      currR === null ||
      currR === undefined ||
      currE === null ||
      currE === undefined
    ) {
      continue;
    }
    if (prevR <= prevE && currR > currE) out.push(i);
    else if (prevR >= prevE && currR < currE) out.push(i);
  }
  return out;
}