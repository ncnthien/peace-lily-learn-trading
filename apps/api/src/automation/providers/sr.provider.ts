import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { Candle, NormalizedSignal, Timeframe } from '@workspace/shared';
import { detectSRZones } from '../../indicators/sr-detector.js';
import {
  MARKET_DATA_SOURCE,
  type MarketDataSource,
} from '../../market-data/market-data.types.js';
import { Provider, type ProviderContext } from './provider.abstract.js';
import { ProviderRegistry } from './provider.registry.js';

/**
 * Number of candles to pull for S/R detection. 200 × 1h ≈ 8 days of
 * 1m bars from the last week — enough pivot history for the
 * default left/right bars to find repeatable swing extremes without
 * the API call getting heavy.
 */
const SR_DEFAULT_CANDLE_LIMIT = 200;

/**
 * SRConfig — the typed config a `supportResistance` AutomationItem
 * carries. Mirrors the discriminated union variant in
 * {@link AutomationInputSchema}. Provider-internal defaults are picked
 * up at evaluate() time so the persisted config stays minimal.
 */
export interface SRConfig {
  symbol: string;
  interval: Timeframe;
  minTouches: number;
}

export interface SRSignal {
  levels: ReturnType<typeof detectSRZones>['levels'];
  currentPrice: number;
  symbol: string;
  interval: Timeframe;
}

/**
 * Support/Resistance detection provider (NCN-14).
 *
 * Reads historical candles via the Market Data layer (NCN-6) and runs
 * the pivot-and-cluster detector (see {@link detectSRZones}) once per
 * evaluation. Each detected level becomes one {@link NormalizedSignal}
 * in the runner's EvalContext so leaf conditions can later target
 * individual zones (NCN-28+ work — see ticket backlog).
 *
 * Why one signal per level (not one summary signal): the existing
 * `NormalizedSignal` shape has a single `timeRange` and `direction`,
 * which can't faithfully represent N zones. Returning an array keeps
 * the rule engine's matching behavior uniform with single-zone sources.
 *
 * Scope note: short-lived detection result. We do NOT persist the
 * levels to {@link SRLine} (that's the manual-curve path via
 * `/sr-lines`). Persisting detected levels is a future concern if the
 * UI wants a snapshot; right now the detector runs per-tick.
 */
@Injectable()
export class SRProvider extends Provider<SRConfig, SRSignal> {
  readonly kind = 'supportResistance';

  constructor(
    registry: ProviderRegistry,
    @Inject(MARKET_DATA_SOURCE)
    private readonly marketData: MarketDataSource,
  ) {
    super();
    registry.register(this);
  }

  validateConfig(raw: unknown): SRConfig {
    if (typeof raw !== 'object' || raw === null) {
      throw new BadRequestException('supportResistance config must be an object');
    }
    const r = raw as { symbol?: unknown; interval?: unknown; minTouches?: unknown };
    if (typeof r.symbol !== 'string' || r.symbol.trim().length === 0) {
      throw new BadRequestException('supportResistance config: symbol is required');
    }
    if (typeof r.interval !== 'string' || r.interval.trim().length === 0) {
      throw new BadRequestException('supportResistance config: interval is required');
    }
    if (
      typeof r.minTouches !== 'number' ||
      !Number.isFinite(r.minTouches) ||
      !Number.isInteger(r.minTouches) ||
      r.minTouches <= 0
    ) {
      throw new BadRequestException(
        'supportResistance config: minTouches must be a positive integer',
      );
    }
    return {
      symbol: r.symbol.trim().toUpperCase(),
      interval: r.interval as Timeframe,
      minTouches: r.minTouches,
    };
  }

  /**
   * Fetch candles + run the detector. Returns null when there isn't
   * enough data for the default pivot window — the runner treats null
   * as "no signal this tick" and skips the item silently (mirrors
   * {@link TimeProvider} when its cron doesn't match).
   */
  async evaluate(
    ctx: ProviderContext & { config: SRConfig },
  ): Promise<SRSignal | null> {
    const { symbol, interval, minTouches } = ctx.config;
    const candles: Candle[] = await this.marketData.getCandles({
      symbol,
      interval,
      limit: SR_DEFAULT_CANDLE_LIMIT,
    });
    const { levels } = detectSRZones(candles, { minTouches });
    if (levels.length === 0) {
      return null;
    }
    const lastClose = candles.at(-1)?.close ?? 0;
    return {
      levels,
      currentPrice: lastClose,
      symbol,
      interval,
    };
  }

  /**
   * One {@link NormalizedSignal} per detected level. The signal's
   * `direction` carries whether the zone is support (`'up'` — price
   * tends to bounce up off it) or resistance (`'down'` — price tends
   * to reject down off it), `phase` is `'developing'` (the zone is
   * currently observed), `degree` is `'macro'` (zones are larger-
   * timeframe constructs than micro/swing signals), and `timeRange`
   * covers the contributing pivots' span.
   *
   * `source` includes symbol + interval so cross-provider leaves can
   * later disambiguate.
   */
  normalize(raw: SRSignal, ctx: ProviderContext): NormalizedSignal[] {
    void ctx;
    return raw.levels.map((level) => ({
      direction: level.kind === 'support' ? ('up' as const) : ('down' as const),
      phase: 'developing' as const,
      degree: 'macro' as const,
      timeRange: {
        // We don't store first-touch in `SupportResistanceLevel`, so the
        // range collapses to the most recent touch. Future work can
        // extend the detector to keep `firstTouchTime` per cluster.
        start: level.lastTouchTime,
        end: level.lastTouchTime,
      },
      source: {
        providerKind: this.kind,
        timeframe: raw.interval,
        symbol: raw.symbol,
      },
    }));
  }
}