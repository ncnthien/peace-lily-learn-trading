import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { Candle, NormalizedSignal, Timeframe } from '@workspace/shared';
import {
  detectWavesFromCandles,
  WAVE_DEFAULTS,
  type WaveSegment,
} from '../../indicators/wave-detector.js';
import {
  MARKET_DATA_SOURCE,
  type MarketDataSource,
} from '../../market-data/market-data.types.js';
import { Provider, type ProviderContext } from './provider.abstract.js';
import { ProviderRegistry } from './provider.registry.js';

/**
 * Default candle window for wave detection. Matches NCN-14's
 * SRProvider so both providers see the same history slice per tick.
 */
const WAVE_DEFAULT_CANDLE_LIMIT = 200;

/**
 * WaveConfig — the typed config a `rsiEmaWave` AutomationItem carries.
 * Mirrors the discriminated union variant in {@link AutomationInputSchema}.
 * Optional fields default to {@link WAVE_DEFAULTS} at evaluate() time.
 */
export interface WaveConfig {
  symbol: string;
  interval: Timeframe;
  noiseThreshold?: number;
  candleLimit?: number;
}

export interface WaveSignal {
  segments: WaveSegment[];
  symbol: string;
  interval: Timeframe;
}

/**
 * RSI/EMA wave detection provider (NCN-15).
 *
 * Reads historical candles via the Market Data layer (NCN-6), runs the
 * pure {@link detectWavesFromCandles} algorithm, and emits one
 * {@link NormalizedSignal} per wave segment. Multi-signal providers
 * use the array-returning `normalize()` shape (post-NCN-14 widening).
 *
 * Each wave's signal encodes its direction ('up' / 'down') so the
 * existing `wave_direction` leaf matches naturally, and its `phase`
 * ('exhausting' for any detected wave with both endpoints) so the
 * `wave_phase_not` leaf can filter. The runner's matcher pulls the
 * source symbol/timeframe through `ConditionSource` as today.
 *
 * Scope note: only completed wave segments are emitted (both
 * crossovers observed). A wave that's mid-flight (no closing crossover
 * yet) isn't in the output — a future iteration could add an "in
 * progress" pseudo-segment with phase='developing'.
 */
@Injectable()
export class WaveProvider extends Provider<WaveConfig, WaveSignal> {
  readonly kind = 'rsiEmaWave';

  constructor(
    registry: ProviderRegistry,
    @Inject(MARKET_DATA_SOURCE)
    private readonly marketData: MarketDataSource,
  ) {
    super();
    registry.register(this);
  }

  validateConfig(raw: unknown): WaveConfig {
    if (typeof raw !== 'object' || raw === null) {
      throw new BadRequestException('rsiEmaWave config must be an object');
    }
    const r = raw as {
      symbol?: unknown;
      interval?: unknown;
      noiseThreshold?: unknown;
      candleLimit?: unknown;
    };
    if (typeof r.symbol !== 'string' || r.symbol.trim().length === 0) {
      throw new BadRequestException('rsiEmaWave config: symbol is required');
    }
    if (typeof r.interval !== 'string' || r.interval.trim().length === 0) {
      throw new BadRequestException('rsiEmaWave config: interval is required');
    }
    const cfg: WaveConfig = {
      symbol: r.symbol.trim().toUpperCase(),
      interval: r.interval as Timeframe,
    };
    if (r.noiseThreshold !== undefined) {
      if (
        typeof r.noiseThreshold !== 'number' ||
        !Number.isFinite(r.noiseThreshold) ||
        r.noiseThreshold < 0
      ) {
        throw new BadRequestException(
          'rsiEmaWave config: noiseThreshold must be a non-negative finite number',
        );
      }
      cfg.noiseThreshold = r.noiseThreshold;
    }
    if (r.candleLimit !== undefined) {
      if (
        typeof r.candleLimit !== 'number' ||
        !Number.isInteger(r.candleLimit) ||
        r.candleLimit <= 0
      ) {
        throw new BadRequestException(
          'rsiEmaWave config: candleLimit must be a positive integer',
        );
      }
      cfg.candleLimit = r.candleLimit;
    }
    return cfg;
  }

  async evaluate(
    ctx: ProviderContext & { config: WaveConfig },
  ): Promise<WaveSignal | null> {
    const { symbol, interval } = ctx.config;
    const candleLimit = ctx.config.candleLimit ?? WAVE_DEFAULT_CANDLE_LIMIT;
    const candles: Candle[] = await this.marketData.getCandles({
      symbol,
      interval,
      limit: candleLimit,
    });
    const segments = detectWavesFromCandles(candles, {
      noiseThreshold:
        ctx.config.noiseThreshold ?? WAVE_DEFAULTS.noiseThreshold,
    });
    if (segments.length === 0) {
      return null;
    }
    return { segments, symbol, interval };
  }

  normalize(raw: WaveSignal, ctx: ProviderContext): NormalizedSignal[] {
    void ctx;
    return raw.segments.map((seg) => ({
      direction: seg.direction,
      phase: seg.phase,
      degree: 'micro',
      timeRange: { start: seg.startTime, end: seg.endTime },
      source: {
        providerKind: this.kind,
        timeframe: raw.interval,
        symbol: raw.symbol,
      },
    }));
  }
}