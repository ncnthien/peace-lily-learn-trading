import type { Candle, PriceTick } from '@workspace/shared';
import type {
  GetCandlesInput,
  MarketDataSource,
  SubscribeInput,
  Unsubscribe,
} from './market-data.types.js';

/**
 * Scriptable MarketDataSource for unit tests. Default behavior:
 *   - getCandles returns [] unless a fixture has been pushed via setCandles
 *   - subscribe delivers nothing until emitTick / emitCandles is called
 *   - emitCandles also broadcasts a tick with the close of the last candle
 *
 * Multiple subscribers per symbol are supported; shutdown() detaches all.
 */
export class MockMarketDataSource implements MarketDataSource {
  private readonly candles = new Map<string, Candle[]>();
  private readonly tickSubscribers = new Map<string, Set<(tick: PriceTick) => void>>();
  private shutdownCalled = false;

  /** Seed historical candles for a symbol (replaces any existing fixture) */
  setCandles(symbol: string, candles: Candle[]): void {
    this.candles.set(symbol.toUpperCase(), candles);
  }

  /** Fan out a single tick to every subscriber of `symbol` */
  emitTick(tick: PriceTick): void {
    const subs = this.tickSubscribers.get(tick.symbol.toUpperCase());
    if (subs === undefined) return;
    for (const cb of subs) {
      cb({ ...tick, symbol: tick.symbol.toUpperCase() });
    }
  }

  /** Push candles to the fixture and broadcast a tick for the latest close */
  emitCandles(symbol: string, candles: Candle[]): void {
    const upper = symbol.toUpperCase();
    this.candles.set(upper, candles);
    const last = candles.at(-1);
    if (last !== undefined) {
      this.emitTick({ symbol: upper, price: last.close, timestamp: last.closeTime });
    }
  }

  async getCandles(input: GetCandlesInput): Promise<Candle[]> {
    const fixture = this.candles.get(input.symbol.toUpperCase()) ?? [];
    // Mirror the Binance source: filter by startTime/endTime, then cap to limit
    // (matching `aggregated.slice(-limit)` semantics).
    const filtered = fixture.filter((c) => {
      if (input.startTime !== undefined && c.openTime < input.startTime) return false;
      if (input.endTime !== undefined && c.openTime >= input.endTime) return false;
      return true;
    });
    return filtered.slice(-input.limit);
  }

  subscribe(
    input: SubscribeInput,
    onTick: (tick: PriceTick) => void,
  ): Unsubscribe {
    const symbol = input.symbol.toUpperCase();
    let subs = this.tickSubscribers.get(symbol);
    if (subs === undefined) {
      subs = new Set();
      this.tickSubscribers.set(symbol, subs);
    }
    subs.add(onTick);
    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      const current = this.tickSubscribers.get(symbol);
      if (current === undefined) return;
      current.delete(onTick);
      if (current.size === 0) this.tickSubscribers.delete(symbol);
    };
  }

  shutdown(): void {
    if (this.shutdownCalled) return;
    this.shutdownCalled = true;
    this.tickSubscribers.clear();
    this.candles.clear();
  }

  /** Test-only introspection */
  subscriberCount(symbol: string): number {
    return this.tickSubscribers.get(symbol.toUpperCase())?.size ?? 0;
  }
}
