// Signal decision — top-level buy/sell/hold verdict produced by the
// indicator pipeline.

export const Signal = {
  BUY: 'BUY',
  SELL: 'SELL',
  HOLD: 'HOLD',
} as const;

export type Signal = (typeof Signal)[keyof typeof Signal];
