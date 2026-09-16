export const Timeframe = {
  ONE_MINUTE: '1m',
  FIVE_MINUTES: '5m',
  FIFTEEN_MINUTES: '15m',
  ONE_HOUR: '1h',
  FOUR_HOURS: '4h',
  ONE_DAY: '1d',
  TWO_DAYS: '2d',
  THREE_DAYS: '3d',
  FOUR_DAYS: '4d',
  FIVE_DAYS: '5d',
  SIX_DAYS: '6d',
  ONE_WEEK: '1w',
} as const;

export type Timeframe = (typeof Timeframe)[keyof typeof Timeframe];

export const Signal = {
  BUY: 'BUY',
  SELL: 'SELL',
  HOLD: 'HOLD',
} as const;

export type Signal = (typeof Signal)[keyof typeof Signal];

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

export interface CandleWithIndicators extends Candle {
  rsi: number | null;
  emaRsi: number | null;
  wmaRsi: number | null;
}

export interface SupportResistanceLevel {
  price: number;
  touches: number;
  kind: 'support' | 'resistance';
  lastTouchTime: number;
}

export interface SupportResistanceResult {
  levels: SupportResistanceLevel[];
}

export interface RsiResult {
  value: number | null;
}

export interface EmaCrossoverResult {
  fast: number | null;
  slow: number | null;
  crossed: 'up' | 'down' | null;
}

export interface WmaResult {
  value: number | null;
}

export interface SignalDecision {
  symbol: string;
  interval: Timeframe;
  signal: Signal;
  price: number;
  evaluatedAt: string;
  indicators: {
    rsi: RsiResult;
    emaCrossover: EmaCrossoverResult;
    wma: WmaResult;
  };
  reason: string;
}
