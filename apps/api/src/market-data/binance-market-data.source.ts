import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { PriceTick, Unsubscribe } from '@workspace/shared';
import { BinanceService } from '../binance/binance.service.js';
import type {
  GetCandlesInput,
  GetLatestPriceInput,
  MarketDataSource,
  SubscribeInput,
} from './market-data.types.js';

/** How often to poll ticker price per active symbol (ms). 1s = responsive without hammering Binance. */
const POLL_INTERVAL_MS = 1_000;

/** Normalize a symbol to the form Binance accepts (trim + uppercase). */
function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

interface SubscriberSet {
  callbacks: Set<(tick: PriceTick) => void>;
  /** Active polling timer for this symbol, or null when no subscribers */
  timer: NodeJS.Timeout | null;
}

/**
 * Production MarketDataSource backed by Binance REST. Historical candles
 * delegate to BinanceService.getKlines (already handles multi-day aggregation).
 * Real-time ticks are produced by polling getPrice per active symbol and
 * fanning out to subscribers — one poll per symbol regardless of subscriber
 * count. A future WebSocket-backed source can swap in without changing
 * callers.
 *
 * getLatestPrice always calls binance.getPrice once for a fresh quote and
 * caches the result. On broker failure, returns the last cached value
 * (graceful degradation) or null if nothing has been observed yet.
 */
@Injectable()
export class BinanceMarketDataSource
  implements MarketDataSource, OnModuleDestroy
{
  private readonly logger = new Logger(BinanceMarketDataSource.name);
  private readonly subscribers = new Map<string, SubscriberSet>();
  private readonly latestPrices = new Map<string, number>();

  constructor(private readonly binance: BinanceService) {}

  async getCandles(input: GetCandlesInput) {
    return this.binance.getKlines(
      normalizeSymbol(input.symbol),
      input.interval,
      input.limit,
      input.startTime,
      input.endTime,
    );
  }

  subscribe(
    input: SubscribeInput,
    onTick: (tick: PriceTick) => void,
  ): Unsubscribe {
    const symbol = normalizeSymbol(input.symbol);
    let set = this.subscribers.get(symbol);
    if (set === undefined) {
      set = { callbacks: new Set(), timer: null };
      this.subscribers.set(symbol, set);
    }

    set.callbacks.add(onTick);
    if (set.timer === null) {
      // Kick off polling on first subscriber. Fire one immediate fetch so
      // subscribers don't wait a full interval for the first tick.
      void this.pollOnce(symbol, set);
      set.timer = setInterval(() => {
        void this.pollOnce(symbol, set as SubscriberSet);
      }, POLL_INTERVAL_MS);
    }

    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      const current = this.subscribers.get(symbol);
      if (current === undefined) return;
      current.callbacks.delete(onTick);
      if (current.callbacks.size === 0) {
        if (current.timer !== null) clearInterval(current.timer);
        this.subscribers.delete(symbol);
      }
    };
  }

  async getLatestPrice(input: GetLatestPriceInput): Promise<number | null> {
    const symbol = normalizeSymbol(input.symbol);
    try {
      const price = await this.binance.getPrice(symbol);
      this.latestPrices.set(symbol, price);
      return price;
    } catch (err) {
      this.logger.warn(
        `getLatestPrice: broker call failed for ${symbol}: ${String(err)} — returning cached value`,
      );
      return this.latestPrices.get(symbol) ?? null;
    }
  }

  shutdown(): void {
    for (const [symbol, set] of this.subscribers) {
      if (set.timer !== null) clearInterval(set.timer);
      // Clear callbacks so any in-flight pollOnce that resolves after this
      // method returns dispatches to nobody.
      set.callbacks.clear();
      this.subscribers.delete(symbol);
    }
    this.latestPrices.clear();
  }

  onModuleDestroy(): void {
    this.shutdown();
  }

  private async pollOnce(symbol: string, set: SubscriberSet): Promise<void> {
    // Snapshot at call time — if shutdown() clears the set during the
    // await, we don't dispatch to anyone.
    const callbacks = set.callbacks;
    try {
      const price = await this.binance.getPrice(symbol);
      this.latestPrices.set(symbol, price);
      const tick: PriceTick = { symbol, price, timestamp: Date.now() };
      for (const cb of callbacks) {
        try {
          cb(tick);
        } catch (err) {
          this.logger.error(
            `Tick subscriber for ${symbol} threw: ${String(err)}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(`Tick poll failed for ${symbol}: ${String(err)}`);
    }
  }
}
