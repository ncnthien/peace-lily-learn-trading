import type { Candle, PriceTick, Timeframe, Unsubscribe } from '@workspace/shared';

/** Historical OHLC query — mirrors Binance klines semantics (paged backwards) */
export interface GetCandlesInput {
  symbol: string;
  interval: Timeframe;
  limit: number;
  /** Epoch milliseconds, inclusive */
  startTime?: number;
  /** Epoch milliseconds, exclusive — candles just before it are returned */
  endTime?: number;
}

/** Real-time subscription input */
export interface SubscribeInput {
  symbol: string;
}

/** Single-shot price query input */
export interface GetLatestPriceInput {
  symbol: string;
}

/**
 * Single abstraction for reading price data (real-time + historical).
 * Used by Automation inputs (S/R touch, wave detection) and PnL
 * mark-to-market. Concrete impls: BinanceMarketDataSource (production),
 * MockMarketDataSource (tests).
 */
export abstract class MarketDataSource {
  /** Fetch historical OHLC candles ordered ascending by openTime */
  abstract getCandles(input: GetCandlesInput): Promise<Candle[]>;

  /** Subscribe to real-time price ticks for a symbol. Returns an Unsubscribe handle */
  abstract subscribe(
    input: SubscribeInput,
    onTick: (tick: PriceTick) => void,
  ): Unsubscribe;

  /**
   * Fetch the most recent known price for a symbol.
   * - BinanceMarketDataSource: calls the broker for a fresh price (and caches
   *   the result so subsequent calls are cheap; on broker failure, returns
   *   the last cached price, or null if none was ever observed).
   * - MockMarketDataSource: returns the value seeded via setLatestPrice.
   * Returns null when no price has been observed yet.
   */
  abstract getLatestPrice(input: GetLatestPriceInput): Promise<number | null>;

  /** Release any resources (intervals, sockets). Safe to call multiple times. */
  abstract shutdown(): void;
}

/** DI token — bind a concrete source in MarketDataModule, inject by this token elsewhere */
export const MARKET_DATA_SOURCE = Symbol('MarketDataSource');
