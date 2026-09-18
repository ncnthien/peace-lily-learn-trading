// Trade side — buy/sell direction on a Trade or Order.

export const TradeSide = {
  BUY: 'buy',
  SELL: 'sell',
} as const;
export type TradeSide = (typeof TradeSide)[keyof typeof TradeSide];
