// Candle interval enum — used by MarketData + Indicators + Automation inputs.
// Adding a new value here automatically extends TimeframeSchema in the schemas layer.

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
