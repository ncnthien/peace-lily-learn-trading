// Pure enum constants — separated from index.ts so schemas/*.ts can
// import them without creating a cycle (index.ts re-exports the
// schemas, schemas need to import these enums).

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

export const AccountType = {
  REAL: 'real',
  DEMO: 'demo',
} as const;
export type AccountType = (typeof AccountType)[keyof typeof AccountType];

export const AccountStatus = {
  ACTIVE: 'active',
  DISABLED: 'disabled',
} as const;
export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus];

export const TradeSide = {
  BUY: 'buy',
  SELL: 'sell',
} as const;
export type TradeSide = (typeof TradeSide)[keyof typeof TradeSide];

export const OrderStatus = {
  PENDING: 'pending',
  FILLED: 'filled',
  CANCELLED: 'cancelled',
  REJECTED: 'rejected',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const AutomationItemStatus = {
  ENABLED: 'enabled',
  DISABLED: 'disabled',
  PAUSED: 'paused',
} as const;
export type AutomationItemStatus =
  (typeof AutomationItemStatus)[keyof typeof AutomationItemStatus];

/** Runtime array of allowed status values; useful for validation. */
export const AUTOMATION_STATUSES = Object.values(AutomationItemStatus);
