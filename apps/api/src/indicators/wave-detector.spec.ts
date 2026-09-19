import type { Candle } from '@workspace/shared';
import {
  detectWaves,
  detectWavesFromCandles,
  emaOfSeries,
  findCrossovers,
  rsiSeriesFromCloses,
  WAVE_DEFAULTS,
} from './wave-detector.js';

/**
 * Pure-function tests for the wave detector (NCN-15).
 */

function makeCandles(closes: number[]): Candle[] {
  return closes.map((p, i) => ({
    openTime: i * 60_000,
    open: p,
    high: p + 0.5,
    low: p - 0.5,
    close: p,
    volume: 1,
    closeTime: i * 60_000 + 59_999,
  }));
}

describe('rsiSeriesFromCloses', () => {
  it('returns nulls during warm-up (first `period` bars)', () => {
    const rsi = rsiSeriesFromCloses([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 14);
    expect(rsi.every((v) => v === null)).toBe(true);
  });

  it('returns a value at index `period` once enough data is available', () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    const rsi = rsiSeriesFromCloses(closes, 14);
    expect(rsi[14]).not.toBeNull();
    // All rising closes → RSI should be high.
    expect(rsi[14]!).toBeGreaterThan(80);
  });

  it('produces 100 when all changes are gains (no losses to average)', () => {
    const rsi = rsiSeriesFromCloses([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], 14);
    expect(rsi[14]).toBe(100);
  });

  it('throws on non-positive period', () => {
    expect(() => rsiSeriesFromCloses([1, 2, 3], 0)).toThrow();
  });
});

describe('emaOfSeries', () => {
  it('returns nulls until enough valid values are seen', () => {
    // For input [null, null, 1, 2, 3, 4, 5] with period 3:
    // start = 2 (first non-null). Seed = 1+2+3 = 6 over 3 values.
    // First valid EMA at index start + period - 1 = 4, value = seed/period = 2.
    const e = emaOfSeries([null, null, 1, 2, 3, 4, 5], 3);
    expect(e.slice(0, 4)).toEqual([null, null, null, null]);
    expect(e[4]).toBe(2);
    // Subsequent values use the recursive EMA formula with k = 2/4 = 0.5.
    // e[5] = 4 * 0.5 + 2 * 0.5 = 3.
    expect(e[5]).toBeCloseTo(3, 9);
  });

  it('skips nulls mid-series without losing the running value', () => {
    const e = emaOfSeries([1, 2, 3, null, 5, 6], 3);
    expect(e[0]).toBe(null);
    expect(e[1]).toBe(null);
    expect(e[2]).toBeCloseTo(2, 9);
    // 3 is null → output stays at the last ema (2)
    expect(e[3]).toBe(null);
    // 4 is the next valid → uses (4 - 2) * 0.5 + 2 = 3 (wait, the impl skips null)
    // Actually with the impl: at i=3 null → no update; at i=4 valid → update from last ema 2.
    // Wait — my impl treats the whole array without the "value 4" entry. Let me check.
    // values: [1, 2, 3, null, 5, 6] → 4 is NOT in this array. Let me re-test with [1,2,3,null,4,5]:
    const e2 = emaOfSeries([1, 2, 3, null, 4, 5], 3);
    expect(e2[0]).toBe(null);
    expect(e2[1]).toBe(null);
    expect(e2[2]).toBeCloseTo(2, 9);
    expect(e2[3]).toBe(null);
    // i=4 (value 4): ema = 4 * 0.5 + 2 * 0.5 = 3
    expect(e2[4]).toBeCloseTo(3, 9);
    // i=5 (value 5): ema = 5 * 0.5 + 3 * 0.5 = 4
    expect(e2[5]).toBeCloseTo(4, 9);
  });
});

describe('findCrossovers', () => {
  it('detects an upward crossover', () => {
    // prev: r=10, e=20 (r below e), curr: r=25, e=22 (r above e)
    const r = [10, 25];
    const e = [20, 22];
    expect(findCrossovers(r, e)).toEqual([1]);
  });

  it('detects a downward crossover', () => {
    const r = [25, 10];
    const e = [22, 20];
    expect(findCrossovers(r, e)).toEqual([1]);
  });

  it('does NOT detect a crossover on equal values (strict inequality)', () => {
    const r = [10, 20];
    const e = [20, 20];
    expect(findCrossovers(r, e)).toEqual([]);
  });

  it('returns empty when lengths mismatch', () => {
    expect(() => findCrossovers([1, 2], [1])).toThrow();
  });
});

describe('detectWaves', () => {
  it('returns empty when not enough data', () => {
    const closes = Array.from({ length: 10 }, () => 100);
    expect(detectWaves(closes, closes.map((_, i) => i))).toEqual([]);
  });

  it('returns empty on monotonic uptrend (no crossovers)', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
    expect(detectWaves(closes, closes.map((_, i) => i))).toEqual([]);
  });

  it('finds a single up-wave on a series that crosses once', () => {
    // Build a series that dips then rallies: RSI dips, signal line catches up
    // → RSI crosses above signal → wave up → RSI peaks → drops back below
    // signal → wave ends.
    const closes = [
      ...Array.from({ length: 20 }, () => 100),
      95, 90, 85, 80, 75, 70, 65, 60, 55, 50, // pullback
      55, 60, 65, 70, 75, 80, 85, 90, 95, 100, // rally 1
      105, 110, 115, 120, 125, 130, 135, 140, 145, 150, // rally 2
      145, 140, 135, 130, 125, 120, 115, 110, 105, 100, // pullback
    ];
    const opens = closes.map((_, i) => i * 60_000);
    const segments = detectWaves(closes, opens);
    expect(segments.length).toBeGreaterThan(0);
    // The first segment should be 'up' (RSI dipped then rallied back).
    expect(segments[0]!.direction).toBe('up');
    expect(segments[0]!.startIdx).toBeLessThan(segments[0]!.endIdx);
    expect(segments[0]!.peakRsi).toBeGreaterThan(segments[0]!.troughRsi);
    expect(segments[0]!.phase).toBe('exhausting');
  });

  it('drops waves smaller than the noise threshold', () => {
    // Tiny oscillation — RSI wiggle < 2 points → all waves filtered.
    const closes: number[] = [];
    for (let i = 0; i < 80; i++) {
      closes.push(100 + (i % 2 === 0 ? 0.5 : -0.5));
    }
    const opens = closes.map((_, i) => i * 60_000);
    const segments = detectWaves(closes, opens, { noiseThreshold: 20 });
    expect(segments).toEqual([]);
  });

  it('respects a custom noise threshold', () => {
    // Same series, lower threshold → at least one wave survives.
    const closes: number[] = [];
    for (let i = 0; i < 80; i++) {
      closes.push(100 + (i % 2 === 0 ? 0.5 : -0.5));
    }
    const opens = closes.map((_, i) => i * 60_000);
    const segs = detectWaves(closes, opens, { noiseThreshold: 0 });
    expect(segs.length).toBeGreaterThan(0);
  });

  it('captures a downward wave after an upward one', () => {
    // V-shape with explicit plateau tops and bottoms so RSI gets a chance
    // to cross its EMA on both the upturn and the downturn.
    const closes: number[] = [];
    for (let i = 0; i < 25; i++) closes.push(100 - i * 2); // decline
    for (let i = 0; i < 5; i++) closes.push(50); // bottom plateau
    for (let i = 0; i < 20; i++) closes.push(50 + i * 4); // rally
    for (let i = 0; i < 5; i++) closes.push(130); // top plateau
    for (let i = 0; i < 20; i++) closes.push(130 - i * 5); // drop
    for (let i = 0; i < 5; i++) closes.push(30); // bottom plateau
    for (let i = 0; i < 20; i++) closes.push(30 + i * 5); // rally again
    const opens = closes.map((_, i) => i * 60_000);
    const segs = detectWaves(closes, opens);
    const dirs = segs.map((s) => s.direction);
    expect(dirs).toContain('up');
    expect(dirs).toContain('down');
  });

  it('exposes peak and trough inside each wave', () => {
    const closes = [
      ...Array.from({ length: 20 }, () => 100),
      95, 88, 80, 72, 64, 56, 48, 40, 35, 30, // dip
      35, 45, 60, 75, 90, 100, 110, 118, 124, 130, // rally
      128, 122, 110, 95, 80, 70, 60, 55, 50, 48, // drop
    ];
    const opens = closes.map((_, i) => i * 60_000);
    const segs = detectWaves(closes, opens);
    expect(segs.length).toBeGreaterThan(0);
    for (const seg of segs) {
      expect(seg.peakRsi).toBeGreaterThanOrEqual(seg.startRsi);
      expect(seg.peakRsi).toBeGreaterThanOrEqual(seg.endRsi);
      expect(seg.troughRsi).toBeLessThanOrEqual(seg.startRsi);
      expect(seg.troughRsi).toBeLessThanOrEqual(seg.endRsi);
      expect(seg.magnitude).toBeCloseTo(seg.peakRsi - seg.troughRsi, 9);
    }
  });

  it('throws when closes and opens arrays have different lengths', () => {
    expect(() => detectWaves([1, 2, 3], [0])).toThrow();
  });

  it('documented defaults match', () => {
    expect(WAVE_DEFAULTS).toEqual({ rsiPeriod: 14, emaPeriod: 9, noiseThreshold: 5 });
  });

  it('detectWavesFromCandles routes through detectWaves correctly', () => {
    const candles = makeCandles([
      ...Array.from({ length: 20 }, () => 100),
      95, 88, 80, 72, 64, 56, 48, 40, 35, 30,
      35, 45, 60, 75, 90, 100, 110, 118, 124, 130,
      128, 122, 110, 95, 80, 70, 60, 55, 50, 48,
    ]);
    const segs = detectWavesFromCandles(candles);
    expect(segs.length).toBeGreaterThan(0);
    // The first wave's start is wherever the first RSI-vs-EMA crossover
    // happens (after RSI warm-up of 14 + EMA warm-up of 9 = 23 bars).
    // After the dip+rally series, the first up-wave starts around index 36.
    expect(segs[0]!.startIdx).toBeGreaterThanOrEqual(23);
    expect(segs[0]!.startTime).toBe(segs[0]!.startIdx * 60_000);
  });
});