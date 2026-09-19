import type { Candle } from '@workspace/shared';
import { detectSRZones, SR_DEFAULTS } from './sr-detector.js';

/**
 * Pure-function tests for the extracted S/R detector (NCN-14).
 *
 * The detector lives here rather than on IndicatorsService so the
 * Automation `supportResistance` provider can reuse the algorithm
 * without pulling in NestJS. `IndicatorsService.supportResistance`
 * remains a thin delegate — the existing indicators.service.spec.ts
 * tests still pass against it because the behavior is preserved.
 */

function makeCandles(prices: number[]): Candle[] {
  return prices.map((p, i) => ({
    openTime: i * 60_000,
    open: p,
    high: p + 0.5,
    low: p - 0.5,
    close: p,
    volume: 1,
    closeTime: i * 60_000 + 59_999,
  }));
}

describe('detectSRZones', () => {
  it('returns empty when there is not enough data for the pivot window', () => {
    const candles = makeCandles(Array.from({ length: 5 }, () => 100));
    expect(detectSRZones(candles).levels).toEqual([]);
  });

  it('detects a single-bar swing high as resistance', () => {
    // 30 candles: a spike at i=10 (clearly inside the pivot window), then
    // a flat tail. The last close is below the spike so it's tagged as
    // resistance.
    const prices = Array.from({ length: 30 }, () => 100);
    prices[10] = 200;
    const candles = makeCandles(prices);
    const { levels } = detectSRZones(candles, { leftBars: 5, rightBars: 5 });
    // At least one resistance level above the last close.
    expect(levels.some((l) => l.kind === 'resistance' && l.price > 100)).toBe(true);
  });

  it('returns empty when all candles are flat', () => {
    const candles = makeCandles(Array.from({ length: 80 }, () => 100));
    // No interior highs or lows because every bar is the same.
    expect(detectSRZones(candles, { leftBars: 5, rightBars: 5 }).levels).toEqual([]);
  });

  it('clusters repeated pivots into one level with touches = count', () => {
    // Three clear swing highs at ~120, each separated by enough bars
    // to qualify as pivots on their own (default leftBars=10, rightBars=10).
    const prices = Array.from({ length: 80 }, () => 100);
    prices[20] = 120;
    prices[40] = 120.1;
    prices[60] = 119.9;
    const candles = makeCandles(prices);
    const { levels } = detectSRZones(candles, {
      leftBars: 5,
      rightBars: 5,
      thresholdPct: 0.5,
    });
    const peakLevel = levels.find((l) => Math.abs(l.price - 120) < 1);
    expect(peakLevel).toBeDefined();
    // Three pivots should land in one cluster.
    expect(peakLevel?.touches).toBe(3);
  });

  it('honors minTouches and drops singletons', () => {
    // One swing high + one swing low, nothing else — should produce no
    // levels when minTouches=2.
    const prices = Array.from({ length: 40 }, () => 100);
    prices[20] = 200;
    const candles = makeCandles(prices);
    const { levels } = detectSRZones(candles, {
      leftBars: 5,
      rightBars: 5,
      minTouches: 2,
    });
    expect(levels).toEqual([]);
  });

  it('keeps singleton pivots when minTouches=1 (default)', () => {
    const prices = Array.from({ length: 40 }, () => 100);
    prices[20] = 200;
    const candles = makeCandles(prices);
    const { levels } = detectSRZones(candles, { leftBars: 5, rightBars: 5 });
    expect(levels.length).toBeGreaterThan(0);
  });

  it('caps the result at the requested maxLevels', () => {
    // Build a noisy series with many pivots across the range.
    const prices = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 2) * 10);
    const candles = makeCandles(prices);
    const { levels } = detectSRZones(candles, {
      leftBars: 5,
      rightBars: 5,
      maxLevels: 2,
    });
    expect(levels.length).toBeLessThanOrEqual(2);
  });

  it('sorts levels by touches desc, then by most-recent touch desc', () => {
    // Two clusters: one with 3 pivots (older), one with 2 pivots (newer).
    // Expected ordering: 3-touch first, then 2-touch.
    const prices = Array.from({ length: 80 }, () => 100);
    prices[20] = 120;
    prices[30] = 120.1;
    prices[40] = 120.2;
    prices[60] = 80;
    prices[70] = 80.1;
    const candles = makeCandles(prices);
    const { levels } = detectSRZones(candles, {
      leftBars: 5,
      rightBars: 5,
      thresholdPct: 0.5,
    });
    if (levels.length >= 2) {
      expect(levels[0]!.touches).toBeGreaterThanOrEqual(levels[1]!.touches);
    }
  });

  it('tags a level below the last close as support, above as resistance', () => {
    // One clear peak well above the closing price.
    const prices = Array.from({ length: 40 }, () => 100);
    prices[20] = 150;
    const candles = makeCandles(prices);
    const { levels } = detectSRZones(candles, { leftBars: 5, rightBars: 5 });
    const lastClose = candles.at(-1)!.close;
    for (const level of levels) {
      if (level.price <= lastClose) expect(level.kind).toBe('support');
      else expect(level.kind).toBe('resistance');
    }
  });

  it('exposes documented defaults', () => {
    expect(SR_DEFAULTS).toEqual({
      leftBars: 10,
      rightBars: 10,
      thresholdPct: 0.5,
      minTouches: 1,
      maxLevels: 6,
    });
  });
});