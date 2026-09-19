import { BadRequestException } from '@nestjs/common';
import type { Candle } from '@workspace/shared';
import type { MarketDataSource } from '../../market-data/market-data.types.js';
import { ProviderRegistry } from './provider.registry.js';
import { SRProvider } from './sr.provider.js';

/**
 * SRProvider tests (NCN-14).
 *
 * MarketData is mocked at the surface the provider actually calls
 * (`getCandles`). The provider's own logic under test:
 *   - validateConfig throws on bad shapes
 *   - evaluate() reads candles via MarketData and runs the detector
 *   - normalize() emits one NormalizedSignal per level, correctly tagged
 *   - returns null when the detector finds nothing (so the runner skips)
 */

function makeCandles(prices: number[]): Candle[] {
  return prices.map((p, i) => ({
    openTime: i * 60_000,
    open: p,
    high: p,
    low: p,
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
 * Build a 60-candle series with explicit spikes at `spikes`. Surrounding
 * candles are flat at 100. With strict pivot comparison (`>=`), flat
 * candles don't generate false-positive pivots — only the spikes do.
 */
function buildSeriesWith(spikes: { idx: number; price: number }[]): number[] {
  const prices = Array.from({ length: 60 }, () => 100);
  for (const { idx, price } of spikes) {
    if (idx >= 0 && idx < prices.length) prices[idx] = price;
  }
  return prices;
}

function buildProvider(candles: Candle[]) {
  const registry = new ProviderRegistry();
  const marketData = makeMarketData(candles);
  const provider = new SRProvider(registry, marketData);
  return { registry, marketData, provider };
}

describe('SRProvider (NCN-14)', () => {
  describe('registration', () => {
    it('self-registers under kind "supportResistance"', () => {
      const { registry, provider } = buildProvider(
        makeCandles(Array.from({ length: 60 }, () => 100)),
      );
      expect(provider.kind).toBe('supportResistance');
      expect(registry.get('supportResistance')).toBe(provider);
    });
  });

  describe('validateConfig', () => {
    it('accepts a well-formed config and uppercases the symbol', () => {
      const { provider } = buildProvider(
        makeCandles(Array.from({ length: 60 }, () => 100)),
      );
      const cfg = provider.validateConfig({
        symbol: 'btcusdt',
        interval: '1h',
        minTouches: 2,
      });
      expect(cfg).toEqual({ symbol: 'BTCUSDT', interval: '1h', minTouches: 2 });
    });

    it('rejects non-object input', () => {
      const { provider } = buildProvider(
        makeCandles(Array.from({ length: 60 }, () => 100)),
      );
      expect(() => provider.validateConfig('nope')).toThrow(BadRequestException);
    });

    it('rejects missing symbol', () => {
      const { provider } = buildProvider(
        makeCandles(Array.from({ length: 60 }, () => 100)),
      );
      expect(() =>
        provider.validateConfig({ interval: '1h', minTouches: 2 }),
      ).toThrow(/symbol/);
    });

    it('rejects missing interval', () => {
      const { provider } = buildProvider(
        makeCandles(Array.from({ length: 60 }, () => 100)),
      );
      expect(() =>
        provider.validateConfig({ symbol: 'BTCUSDT', minTouches: 2 }),
      ).toThrow(/interval/);
    });

    it('rejects non-positive minTouches', () => {
      const { provider } = buildProvider(
        makeCandles(Array.from({ length: 60 }, () => 100)),
      );
      expect(() =>
        provider.validateConfig({ symbol: 'BTCUSDT', interval: '1h', minTouches: 0 }),
      ).toThrow(/minTouches/);
      expect(() =>
        provider.validateConfig({
          symbol: 'BTCUSDT',
          interval: '1h',
          minTouches: 1.5,
        }),
      ).toThrow(/minTouches/);
      expect(() =>
        provider.validateConfig({
          symbol: 'BTCUSDT',
          interval: '1h',
          minTouches: -1,
        }),
      ).toThrow(/minTouches/);
    });
  });

  describe('evaluate', () => {
    it('pulls candles from MarketData and returns the detected levels', async () => {
      const prices = buildSeriesWith([{ idx: 20, price: 120 }, { idx: 35, price: 80 }]);
      const { provider } = buildProvider(makeCandles(prices));

      const raw = await provider.evaluate({
        config: { symbol: 'BTCUSDT', interval: '1h', minTouches: 1 },
        now: Date.now(),
        symbol: 'BTCUSDT',
        timeframe: '1h',
      });
      expect(raw).not.toBeNull();
      expect(raw!.levels.length).toBeGreaterThan(0);
      expect(raw!.symbol).toBe('BTCUSDT');
      expect(raw!.interval).toBe('1h');
      // currentPrice is the last close.
      expect(raw!.currentPrice).toBe(100);
    });

    it('returns null when the detector finds no zones', async () => {
      const { provider } = buildProvider(
        makeCandles(Array.from({ length: 60 }, () => 100)),
      );

      const raw = await provider.evaluate({
        config: { symbol: 'BTCUSDT', interval: '1h', minTouches: 1 },
        now: Date.now(),
      });
      expect(raw).toBeNull();
    });

    it('passes symbol and interval into the MarketData call', async () => {
      const { provider, marketData } = buildProvider(
        makeCandles(Array.from({ length: 60 }, () => 100)),
      );

      await provider.evaluate({
        config: { symbol: 'BTCUSDT', interval: '4h', minTouches: 1 },
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

    it('honors minTouches: drops single-pivot levels', async () => {
      // One peak, one trough — minTouches=2 leaves nothing.
      const prices = buildSeriesWith([{ idx: 20, price: 120 }]);
      const { provider } = buildProvider(makeCandles(prices));

      const raw = await provider.evaluate({
        config: { symbol: 'BTCUSDT', interval: '1h', minTouches: 2 },
        now: Date.now(),
      });
      expect(raw).toBeNull();
    });
  });

  describe('normalize', () => {
    it('emits one signal per level tagged with the right direction', async () => {
      const prices = buildSeriesWith([{ idx: 20, price: 120 }]);
      const { provider } = buildProvider(makeCandles(prices));

      const raw = await provider.evaluate({
        config: { symbol: 'BTCUSDT', interval: '1h', minTouches: 1 },
        now: Date.now(),
      });
      const signals = provider.normalize(raw!, {
        now: Date.now(),
        symbol: 'BTCUSDT',
        timeframe: '1h',
      });
      expect(Array.isArray(signals)).toBe(true);
      expect((signals as { direction: string }[]).length).toBe(raw!.levels.length);
      for (const signal of signals) {
        // direction encoded from level.kind: support → 'up', resistance → 'down'.
        expect(['up', 'down']).toContain(signal.direction);
        expect(signal.phase).toBe('developing');
        expect(signal.degree).toBe('macro');
        expect(signal.source.providerKind).toBe('supportResistance');
        expect(signal.source.symbol).toBe('BTCUSDT');
        expect(signal.source.timeframe).toBe('1h');
      }
    });

    it('tags support zones with direction=up and resistance with direction=down', async () => {
      const prices = buildSeriesWith([
        { idx: 20, price: 150 },
        { idx: 40, price: 50 },
      ]);
      const { provider } = buildProvider(makeCandles(prices));

      const raw = await provider.evaluate({
        config: { symbol: 'BTCUSDT', interval: '1h', minTouches: 1 },
        now: Date.now(),
      });
      const signals = provider.normalize(raw!, {
        now: Date.now(),
        symbol: 'BTCUSDT',
        timeframe: '1h',
      });
      const supportSignals = (signals as { direction: string }[]).filter(
        (s) => s.direction === 'up',
      );
      const resistanceSignals = (signals as { direction: string }[]).filter(
        (s) => s.direction === 'down',
      );
      expect(supportSignals.length).toBeGreaterThan(0);
      expect(resistanceSignals.length).toBeGreaterThan(0);
    });
  });
});