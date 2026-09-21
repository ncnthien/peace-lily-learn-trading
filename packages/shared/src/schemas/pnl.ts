import { z } from 'zod';

// ============================================================
// Realized PnL (NCN-20)
// ============================================================
// One entry per closed (matched) sell. A "close" is the portion of a
// sell that matched against an open buy lot via FIFO. Partial closes
// produce one entry with `qty < sell.qty` and multiple `matchedBuys`
// entries when the sell spans several buy lots.
// ============================================================

export const ClosedLotMatchSchema = z
  .object({
    buyTradeId: z.string().min(1),
    /** Quantity from this buy lot that the sell consumed. */
    qty: z.number().finite().positive(),
    /** Cost basis per unit at the time of the original buy. */
    costPerUnit: z.number().finite().nonnegative(),
  })
  .strict();

export const RealizedPnlMatchSchema = z
  .object({
    sellTradeId: z.string().min(1),
    sellTimestamp: z.string(),
    symbol: z.string().min(1),
    /** Total quantity closed by this sell (sum of matchedBuys[].qty). */
    qty: z.number().finite().positive(),
    /** Realized PnL for this sell: sum over matchedBuys of qty * (proceedsPerUnit - costPerUnit). */
    realizedPnl: z.number(),
    /** Per-unit fee allocated from the sell side, when present. */
    sellFeePerUnit: z.number().finite().nonnegative(),
    matchedBuys: z.array(ClosedLotMatchSchema),
  })
  .strict();

export const RealizedPnlSummarySchema = z
  .object({
    accountId: z.string().min(1),
    /** Sum of all realized PnlMatch.realizedPnl for this account. */
    totalRealizedPnl: z.number(),
    /** Aggregated per symbol. Empty object if no realized PnL. */
    perSymbol: z.record(z.string(), z.number()),
    /** Per closed sell. Empty array if no sells (yet). */
    matches: z.array(RealizedPnlMatchSchema),
  })
  .strict();

export type ClosedLotMatch = z.infer<typeof ClosedLotMatchSchema>;
export type RealizedPnlMatch = z.infer<typeof RealizedPnlMatchSchema>;
export type RealizedPnlSummary = z.infer<typeof RealizedPnlSummarySchema>;

// ============================================================
// Unrealized PnL (NCN-21)
// ============================================================
// Computed at request time by walking the Trade ledger (one open
// position per account+symbol, averaged across all open buy lots)
// and marking to the latest price observed by MarketDataSource.
// =========================================================================
//
// `markPrice` and `pricedAt` come from MarketDataSource.getLatestPrice.
// When the source has no price yet (mock seed not set, broker 404,
// fresh symbol never quoted), `markPrice` is null and `unrealizedPnl`
// is null too — the UI distinguishes "I couldn't get a price" from
// "the price gives me zero PnL".
//
// `openedAt` is the timestamp of the *first* open lot contributing to
// the position; recalculating it from the FIFO walk rather than
// reading the Trade schema's `timestamp` lets a future "merge position
// on opposite side" feature stay accurate.
// =========================================================================

export const UnrealizedPositionSchema = z
  .object({
    accountId: z.string().min(1),
    symbol: z.string().min(1),
    /** Long position only for the demo flow; mirrors Trade.side */
    side: z.enum(['buy']),
    /** Volume-weighted average of all open buy lots. Always positive. */
    qty: z.number().finite().positive(),
    /** Volume-weighted average cost per unit (includes buy-side fees). */
    avgEntryPrice: z.number().finite().nonnegative(),
    /** Last mark observed from MarketDataSource; null when no price is known yet. */
    markPrice: z.number().finite().nonnegative().nullable(),
    /** `qty * (markPrice - avgEntryPrice)`; null when `markPrice` is null. */
    unrealizedPnl: z.number().nullable(),
    /** Epoch ms when the mark price was observed; null when no mark is available. */
    pricedAt: z.string().nullable(),
    /** Timestamp of the oldest buy still contributing to the position. */
    openedAt: z.string(),
  })
  .strict();

export const UnrealizedPnlSummarySchema = z
  .object({
    accountId: z.string().min(1),
    /** Sum of `positions[].unrealizedPnl`; null entries are skipped. */
    totalUnrealizedPnl: z.number(),
    /** Aggregated per symbol — same convention as the realized summary. */
    perSymbol: z.record(z.string(), z.number()),
    positions: z.array(UnrealizedPositionSchema),
  })
  .strict();

export type UnrealizedPosition = z.infer<typeof UnrealizedPositionSchema>;
export type UnrealizedPnlSummary = z.infer<typeof UnrealizedPnlSummarySchema>;

// ============================================================
// Account dashboard (NCN-22)
// ============================================================
// A single payload the home dashboard reads on mount. Composed
// from existing pieces (Account + realized summary + unrealized
// summary) plus a bucketed PnL time series so the client doesn't
// have to round-trip three or four endpoints to render one view.
// =========================================================================

/**
 * How the realized-PnL time series is bucketed.
 * - `day`:   each entry sums one UTC calendar day's realized matches,
 *            `bucketStart` is the day's YYYY-MM-DD.
 * - `week`:  each entry sums one ISO week (Monday-anchored); `bucketStart`
 *            is the Monday's YYYY-MM-DD.
 * - `month`: each entry sums one calendar month; `bucketStart` is the
 *            month's first day as YYYY-MM-DD.
 *
 * Bucketing is computed server-side from `RealizedPnlMatch.sellTimestamp`
 * (ISO 8601 UTC strings); the UI distinguishes the three by formatting
 * the `bucketStart` accordingly.
 */
export const PnlBucketSchema = z.enum(['day', 'week', 'month']);
export type PnlBucket = z.infer<typeof PnlBucketSchema>;

export const PnlBucketPointSchema = z
  .object({
    /** Inclusive bucket start (UTC). For week buckets this is the Monday. */
    bucketStart: z.string(),
    /** Sum of realized PnL across all closed sells inside this bucket. */
    pnl: z.number(),
  })
  .strict();

export const AccountDashboardSchema = z
  .object({
    account: z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      type: z.enum(['real', 'demo']),
      balance: z.number().finite(),
      status: z.string(),
      createdAt: z.string(),
      updatedAt: z.string(),
    }),
    /** `balance + totalUnrealizedPnl`. Standard trading-account equity. */
    equity: z.number(),
    totals: z.object({
      realized: z.number(),
      unrealized: z.number(),
    }),
    /** Selected bucket. Echoed back so the client doesn't have to track it. */
    bucket: PnlBucketSchema,
    /** Time series, sorted ascending by `bucketStart`. Empty array when no closed sells. */
    pnlSeries: z.array(PnlBucketPointSchema),
  })
  .strict();

export type PnlBucketPoint = z.infer<typeof PnlBucketPointSchema>;
export type AccountDashboard = z.infer<typeof AccountDashboardSchema>;
