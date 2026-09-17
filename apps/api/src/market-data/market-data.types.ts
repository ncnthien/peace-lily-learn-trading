import type { Candle, PriceTick, Timeframe } from '@workspace/shared';

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

/** Real-time subscription handle — call to stop receiving ticks (idempotent) */
export type Unsubscribe = () => void;

/** Tick subscription input */
export interface SubscribeInput {
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

  /** Release any resources (intervals, sockets). Safe to call multiple times. */
  abstract shutdown(): void;
}

/** DI token — bind a concrete source in MarketDataModule, inject by this token elsewhere */
export const MARKET_DATA_SOURCE = Symbol('MarketDataSource');
