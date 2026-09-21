import { BadRequestException } from '@nestjs/common';
import type { Candle } from '@workspace/shared';
import type { MarketDataSource } from '../../market-data/market-data.types.js';
import { ProviderRegistry } from './provider.registry.js';
import { WaveProvider } from './wave.provider.js';

/**
 * WaveProvider tests (NCN-15).
 *
 * Mirrors the SRProvider test shape: MarketData is mocked at the
 * surface the provider actually uses (`getCandles`). The provider's
 * own logic under test:
 *   - validateConfig throws on bad shapes
 *   - evaluate() reads candles via MarketData and runs the detector
 *   - normalize() emits one NormalizedSignal per detected wave,
 *     correctly tagged with direction + phase + source coordinates
 *   - returns null when the detector finds nothing
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

function makeMarketData(candles: Candle[]): MarketDataSource {
  return {
    getCandles: vi.fn(async () => candles),
    subscribe: vi.fn(() => () => {}),
    getLatestPrice: vi.fn(async () => candles.at(-1)?.close ?? null),
    shutdown: vi.fn(),
  };
}

/**
 * 100-bar series with explicit plateau tops and bottoms so RSI crosses
 * its EMA in both directions. Used by provider tests that need both
 * 'up' and 'down' segments.
 */
function seriesWithUpAndDownWaves(): number[] {
  const closes: number[] = [];
  for (let i = 0; i < 25; i++) closes.push(100 - i * 2);
  for (let i = 0; i < 5; i++) closes.push(50);
  for (let i = 0; i < 20; i++) closes.push(50 + i * 4);
  for (let i = 0; i < 5; i++) closes.push(130);
  for (let i = 0; i < 20; i++) closes.push(130 - i * 5);
  for (let i = 0; i < 5; i++) closes.push(30);
  for (let i = 0; i < 20; i++) closes.push(30 + i * 5);
  return closes;
}

/**
 * 60-candle series with a clear single up-wave (RSI dips then rallies).
 */
function seriesWithClearWave(): number[] {
  return [
    ...Array.from({ length: 20 }, () => 100),
    95, 88, 80, 72, 64, 56, 48, 40, 35, 30,
    35, 45, 60, 75, 90, 100, 110, 118, 124, 130,
    128, 122, 110, 95, 80, 70, 60, 55, 50, 48,
  ];
}

function buildProvider(candles: Candle[]) {
  const registry = new ProviderRegistry();
  const marketData = makeMarketData(candles);
  const provider = new WaveProvider(registry, marketData);
  return { registry, marketData, provider };
}

describe('WaveProvider (NCN-15)', () => {
  describe('registration', () => {
    it('self-registers under kind "rsiEmaWave"', () => {
      const { registry, provider } = buildProvider(
        makeCandles(Array.from({ length: 60 }, () => 100)),
      );
      expect(provider.kind).toBe('rsiEmaWave');
      expect(registry.get('rsiEmaWave')).toBe(provider);
    });
  });

  describe('validateConfig', () => {
    it('accepts a minimal { symbol, interval } config and uppercases symbol', () => {
      const { provider } = buildProvider(
        makeCandles(Array.from({ length: 60 }, () => 100)),
      );
      const cfg = provider.validateConfig({
        kind: 'rsiEmaWave',
        symbol: 'btcusdt',
        interval: '1h',
      });
      expect(cfg).toEqual({ symbol: 'BTCUSDT', interval: '1h' });
    });

    it('accepts noiseThreshold and candleLimit when valid', () => {
      const { provider } = buildProvider(
        makeCandles(Array.from({ length: 60 }, () => 100)),
      );
      const cfg = provider.validateConfig({
        kind: 'rsiEmaWave',
        symbol: 'BTCUSDT',
        interval: '1h',
        noiseThreshold: 7.5,
        candleLimit: 300,
      });
      expect(cfg.noiseThreshold).toBe(7.5);
      expect(cfg.candleLimit).toBe(300);
    });

    it('rejects non-object input', () => {
      const { provider } = buildProvider(
        makeCandles(Array.from({ length: 60 }, () => 100)),
      );
      expect(() => provider.validateConfig('oops')).toThrow(BadRequestException);
    });

    it('rejects missing symbol', () => {
      const { provider } = buildProvider(
        makeCandles(Array.from({ length: 60 }, () => 100)),
      );
      expect(() =>
        provider.validateConfig({ kind: 'rsiEmaWave', interval: '1h' }),
      ).toThrow(/symbol/);
    });

    it('rejects missing interval', () => {
      const { provider } = buildProvider(
        makeCandles(Array.from({ length: 60 }, () => 100)),
      );
      expect(() =>
        provider.validateConfig({ kind: 'rsiEmaWave', symbol: 'BTCUSDT' }),
      ).toThrow(/interval/);
    });

    it('rejects negative noiseThreshold', () => {
      const { provider } = buildProvider(
        makeCandles(Array.from({ length: 60 }, () => 100)),
      );
      expect(() =>
        provider.validateConfig({
          kind: 'rsiEmaWave',
          symbol: 'BTCUSDT',
          interval: '1h',
          noiseThreshold: -1,
        }),
      ).toThrow(/noiseThreshold/);
    });

    it('rejects non-integer candleLimit', () => {
      const { provider } = buildProvider(
        makeCandles(Array.from({ length: 60 }, () => 100)),
      );
      expect(() =>
        provider.validateConfig({
          kind: 'rsiEmaWave',
          symbol: 'BTCUSDT',
          interval: '1h',
          candleLimit: 1.5,
        }),
      ).toThrow(/candleLimit/);
    });
  });

  describe('evaluate', () => {
    it('pulls candles from MarketData and returns detected waves', async () => {
      const { provider } = buildProvider(makeCandles(seriesWithClearWave()));
      const raw = await provider.evaluate({
        config: { symbol: 'BTCUSDT', interval: '1h' },
        now: Date.now(),
        symbol: 'BTCUSDT',
        timeframe: '1h',
      });
      expect(raw).not.toBeNull();
      expect(raw!.segments.length).toBeGreaterThan(0);
      expect(raw!.symbol).toBe('BTCUSDT');
      expect(raw!.interval).toBe('1h');
    });

    it('returns null when the detector finds no waves', async () => {
      // Monotonic uptrend → no crossovers
      const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
      const { provider } = buildProvider(makeCandles(closes));
      const raw = await provider.evaluate({
        config: { symbol: 'BTCUSDT', interval: '1h' },
        now: Date.now(),
      });
      expect(raw).toBeNull();
    });

    it('passes symbol + interval + limit to MarketData.getCandles', async () => {
      const { provider, marketData } = buildProvider(
        makeCandles(Array.from({ length: 60 }, () => 100)),
      );
      await provider.evaluate({
        config: { symbol: 'BTCUSDT', interval: '4h' },
        now: Date.now(),
        symbol: 'BTCUSDT',
        timeframe: '4h',
      });
      expect(marketData.getCandles).toHaveBeenCalledWith({
        symbol: 'BTCUSDT',
        interval: '4h',
        limit: expect.any(Number),
      });
    });

    it('honors a custom candleLimit when configured', async () => {
      const { provider, marketData } = buildProvider(
        makeCandles(Array.from({ length: 60 }, () => 100)),
      );
      await provider.evaluate({
        config: { symbol: 'BTCUSDT', interval: '1h', candleLimit: 400 },
        now: Date.now(),
      });
      expect(marketData.getCandles).toHaveBeenCalledWith({
        symbol: 'BTCUSDT',
        interval: '1h',
        limit: 400,
      });
    });

    it('honors a custom noiseThreshold (filters tiny waves)', async () => {
      // Tiny oscillations filtered by a 20-point threshold.
      const closes: number[] = [];
      for (let i = 0; i < 80; i++) {
        closes.push(100 + (i % 2 === 0 ? 0.5 : -0.5));
      }
      const { provider } = buildProvider(makeCandles(closes));
      const raw = await provider.evaluate({
        config: { symbol: 'BTCUSDT', interval: '1h', noiseThreshold: 20 },
        now: Date.now(),
      });
      expect(raw).toBeNull();
    });
  });

  describe('normalize', () => {
    it('emits one NormalizedSignal per detected wave', async () => {
      const { provider } = buildProvider(makeCandles(seriesWithClearWave()));
      const raw = await provider.evaluate({
        config: { symbol: 'BTCUSDT', interval: '1h' },
        now: Date.now(),
        symbol: 'BTCUSDT',
        timeframe: '1h',
      });
      const signals = provider.normalize(raw!, {
        now: Date.now(),
        symbol: 'BTCUSDT',
        timeframe: '1h',
      });
      expect(Array.isArray(signals)).toBe(true);
      expect((signals as { direction: string }[]).length).toBe(raw!.segments.length);
      for (const signal of signals as { direction: string; phase: string; source: { providerKind: string } }[]) {
        expect(['up', 'down']).toContain(signal.direction);
        expect(['forming', 'developing', 'exhausting']).toContain(signal.phase);
        expect(signal.source.providerKind).toBe('rsiEmaWave');
        expect(signal.source.symbol).toBe('BTCUSDT');
        expect(signal.source.timeframe).toBe('1h');
      }
    });

    it('wave direction tags up vs down correctly', async () => {
      const { provider } = buildProvider(makeCandles(seriesWithUpAndDownWaves()));
      const raw = await provider.evaluate({
        config: { symbol: 'BTCUSDT', interval: '1h' },
        now: Date.now(),
        symbol: 'BTCUSDT',
        timeframe: '1h',
      });
      const signals = provider.normalize(raw!, {
        now: Date.now(),
        symbol: 'BTCUSDT',
        timeframe: '1h',
      }) as { direction: string }[];
      const ups = signals.filter((s) => s.direction === 'up');
      const downs = signals.filter((s) => s.direction === 'down');
      expect(ups.length).toBeGreaterThan(0);
      expect(downs.length).toBeGreaterThan(0);
    });
  });
});