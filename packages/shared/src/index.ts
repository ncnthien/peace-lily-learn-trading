// Import schema-driven types AND enums into local scope (re-export-only
// imports aren't visible within this file for declarations). The enum
// constants live in ./enums/<domain>.ts — one file per domain, mirroring
// the schemas/ structure.
import type { ConditionSource } from './schemas/index.js';
import {
  AUTOMATION_STATUSES,
  AccountStatus,
  AccountType,
  AutomationItemStatus,
  OrderStatus,
  Signal,
  Timeframe,
  TradeSide,
} from './enums/index.js';
export {
  AUTOMATION_STATUSES,
  AccountStatus,
  AccountType,
  AutomationItemStatus,
  OrderStatus,
  Signal,
  Timeframe,
  TradeSide,
} from './enums/index.js';

// Re-export the schema-driven types AND the Zod schemas themselves.
// The schemas are the runtime source of truth; the types are inferred.
// Both consumers (`@workspace/api` for ValidationPipe decorators,
// `apps/web` for client-side validation) import from this module.
export type {
  Account,
  CreateAccountDraft,
  UpdateAccountPatch,
  Order,
  PlaceOrderInput,
  OrderEvent,
  Trade,
  AutomationInput,
  ConditionSource,
  LeafCondition,
  CompositeCondition,
  ConditionNode,
  AutomationAction,
  AutomationOutput,
  AutomationItem,
  CreateAutomationInput,
  UpdateAutomationInput,
  TimeConfig,
} from './schemas/index.js';

export {
  AccountSchema,
  CreateAccountDraftSchema,
  UpdateAccountPatchSchema,
  OrderSchema,
  PlaceOrderInputSchema,
  OrderEventSchema,
  TradeSchema,
  AutomationInputSchema,
  ConditionSourceSchema,
  LeafConditionSchema,
  CompositeConditionSchema,
  ConditionNodeSchema,
  AutomationActionSchema,
  AutomationOutputSchema,
  AutomationItemSchema,
  AutomationItemStatusSchema,
  CreateAutomationInputSchema,
  UpdateAutomationInputSchema,
  TimeConfigSchema,
  TimeframeSchema,
  AccountTypeSchema,
  AccountStatusSchema,
  TradeSideSchema,
  OrderStatusSchema,
} from './schemas/index.js';

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

// ============================================================
// NCN-6: Market Data abstraction — real-time price tick contract.
// Consumed by Automation inputs (S/R touch, wave detection) and
// PnL mark-to-market. The MarketDataSource interface itself lives
// in apps/api (NestJS DI concern); the data shape is shared.
// ============================================================

/** Real-time price update emitted by a MarketDataSource subscription */
export interface PriceTick {
  symbol: string;
  /** Latest trade / mid price */
  price: number;
  /** Epoch milliseconds when the source observed the price */
  timestamp: number;
}

/** Subscription handle — call to stop receiving updates (idempotent) */
export type Unsubscribe = () => void;

/** Open position per account + symbol, carrying unrealized state.
 * Kept as an interface (not on the API boundary yet). */
export interface Position {
  id: string;
  accountId: string;
  symbol: string;
  side: TradeSide;
  /** Remaining size (absolute value) */
  qty: number;
  /** Volume-weighted average entry price of the position */
  avgEntryPrice: number;
  /** Mark-to-market PnL against the latest price; null when no mark price is available */
  unrealizedPnl: number | null;
  openedAt: string;
  updatedAt: string;
}

// ============================================================
// EvalContext — kept as a hand-written interface because it stays an
// internal engine-only type (never crosses the HTTP boundary). The
// leaf types above are schema-driven.
// ============================================================

export interface EvalContext {
  /** All normalized signals currently in scope */
  signals: NormalizedSignal[];
  /**
   * Numeric indicator values keyed by `${providerKind}:${timeframe}:${symbol}`
   * (any segment may be empty string when omitted in the source).
   * RSI leaves read from here via their source coordinates.
   */
  indicators?: Record<string, number | null>;
  /** Current epoch ms — used by time-relative leaves */
  now: number;
}

/**
 * Build the canonical lookup key for an indicator (e.g. RSI) value from a
 * ConditionSource. Empty segments stay in the key so that `{}` and
 * `{providerKind: 'foo'}` don't collide with `{providerKind: 'foo:'}`.
 */
export function indicatorKey(source: ConditionSource): string {
  return `${source.providerKind}:${source.timeframe ?? ''}:${source.symbol ?? ''}`;
}

/** Supported signal degrees (scale/timeframe classification) */
export type AutomationDegree = 'macro' | 'micro' | string;

/** Lifecycle phase of a wave / signal — used for phase-lag detection */
export type AutomationPhase = 'forming' | 'developing' | 'exhausting';

/** Direction a wave / signal points */
export type AutomationDirection = 'up' | 'down';

/**
 * Provider-agnostic signal shape produced by the Normalizer layer.
 * Every provider's raw output is converted to this so leaves in the
 * ConditionNode tree can match signals from different sources without
 * knowing how each was produced.
 */
export interface NormalizedSignal {
  direction: AutomationDirection;
  phase: AutomationPhase;
  degree: AutomationDegree;
  /** Inclusive start, exclusive end — both in epoch ms */
  timeRange: { start: number; end: number };
  /** Where the signal came from. providerKind matches a registered Provider.kind. */
  source: { providerKind: string; timeframe?: string; symbol?: string };
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
