import type { Candle, SupportResistanceLevel, SupportResistanceResult } from '@workspace/shared';

/**
 * S/R detection options. All optional; sensible defaults from the
 * indicators package.
 */
export interface SRDetectorOptions {
  /** Bars to the left of a candidate pivot that must be lower (highs) / higher (lows) */
  leftBars?: number;
  /** Bars to the right of a candidate pivot that must be lower (highs) / higher (lows) */
  rightBars?: number;
  /** Two pivots within thresholdPct of each other (of last close) merge into one zone */
  thresholdPct?: number;
  /** Drop zones with fewer than this many contributing pivots */
  minTouches?: number;
  /** Cap on zones returned, ranked by touches then by most-recent touch */
  maxLevels?: number;
}

/**
 * Default pivot/cluster parameters. Kept here (not in the IndicatorsService)
 * so the SRProvider can reuse them without coupling to NestJS.
 *
 * Sensible defaults for 1h BTC candles; tighter intervals may want
 * smaller left/right bars. Override via {@link detectSRZones} options.
 */
export const SR_DEFAULTS = {
  leftBars: 10,
  rightBars: 10,
  thresholdPct: 0.5,
  minTouches: 1,
  maxLevels: 6,
} as const;

/**
 * Pure S/R zone detector (NCN-14).
 *
 * Reusable by both the `/indicators/levels` HTTP endpoint (via
 * {@link IndicatorsService.supportResistance}) and the Automation
 * `supportResistance` input provider. Algorithm:
 *
 *   1. **Pivot scan** — every interior candle is checked: is it a
 *      swing high (its `high` is the max in `[i-leftBars, i+rightBars]`)
 *      and/or a swing low (its `low` is the min)?
 *   2. **Cluster** — pivots within `thresholdPct` of the cluster mean
 *      (using the last candle's close as the scale anchor) merge into
 *      a single zone. Each cluster's `lastTouchTime` is the max pivot
 *      timestamp in that cluster.
 *   3. **Filter + rank** — clusters with fewer than `minTouches` pivots
 *      are dropped. Survivors are sorted by touches desc, then by
 *      most-recent touch desc, then truncated to `maxLevels`.
 *
 * Each returned level's `kind` is inferred from the last candle's close:
 *   - level.price <= lastClose → 'support'
 *   - level.price >  lastClose → 'resistance'
 *
 * The detector does NOT consult market data, look up live prices, or
 * mutate the input. The caller supplies candles already in ascending
 * openTime order (the standard shape coming out of MarketDataSource).
 */
export function detectSRZones(
  candles: readonly Candle[],
  options: SRDetectorOptions = {},
): SupportResistanceResult {
  const leftBars = options.leftBars ?? SR_DEFAULTS.leftBars;
  const rightBars = options.rightBars ?? SR_DEFAULTS.rightBars;
  const thresholdPct = options.thresholdPct ?? SR_DEFAULTS.thresholdPct;
  const minTouches = options.minTouches ?? SR_DEFAULTS.minTouches;
  const maxLevels = options.maxLevels ?? SR_DEFAULTS.maxLevels;

  if (candles.length < leftBars + rightBars + 1) {
    return { levels: [] };
  }

  // 1. Pivot scan — emit one entry per swing high and swing low.
  // Strict inequality (`>=` / `<=`) is used to disqualify ties: a candle
  // is a swing high only when its `high` is STRICTLY greater than every
  // other candle in the window. The original `>` would mark every flat
  // interior candle as both a swing high AND a swing low (since equal
  // values don't disqualify), producing false-positive clusters on
  // genuinely flat regions of price.
  const pivots: { price: number; time: number }[] = [];
  for (let i = leftBars; i < candles.length - rightBars; i++) {
    const c = candles[i]!;
    let isHigh = true;
    let isLow = true;
    for (let j = i - leftBars; j <= i + rightBars; j++) {
      if (j === i) continue;
      if (candles[j]!.high >= c.high) isHigh = false;
      if (candles[j]!.low <= c.low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) pivots.push({ price: c.high, time: c.openTime });
    if (isLow) pivots.push({ price: c.low, time: c.openTime });
  }

  // 2. Cluster — group pivots within `threshold` of each other. The
  // absolute threshold is anchored to the last candle's close, so the
  // same percentage means the same dollar tolerance across price levels.
  const lastClose = candles.at(-1)?.close ?? 0;
  const threshold = (lastClose * thresholdPct) / 100 || 1;
  const clusters: { prices: number[]; lastTouchTime: number }[] = [];
  for (const pivot of pivots) {
    const existing = clusters.find(
      (cluster) =>
        Math.abs(
          cluster.prices.reduce((sum, p) => sum + p, 0) / cluster.prices.length -
            pivot.price,
        ) <= threshold,
    );
    if (existing !== undefined) {
      existing.prices.push(pivot.price);
      existing.lastTouchTime = Math.max(existing.lastTouchTime, pivot.time);
    } else {
      clusters.push({ prices: [pivot.price], lastTouchTime: pivot.time });
    }
  }

  // 3. Build + filter + rank. `kind` is derived from the last close:
  // above = resistance (price rejected from above), below = support.
  const levels: SupportResistanceLevel[] = clusters
    .filter((cluster) => cluster.prices.length >= minTouches)
    .map((cluster) => {
      const price = cluster.prices.reduce((sum, p) => sum + p, 0) / cluster.prices.length;
      return {
        price,
        touches: cluster.prices.length,
        kind: price <= lastClose ? ('support' as const) : ('resistance' as const),
        lastTouchTime: cluster.lastTouchTime,
      };
    });

  levels.sort(
    (a, b) => b.touches - a.touches || b.lastTouchTime - a.lastTouchTime,
  );
  return { levels: levels.slice(0, maxLevels) };
}