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
