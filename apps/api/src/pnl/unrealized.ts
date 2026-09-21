/**
 * Unrealized PnL support (NCN-21).
 *
 * Pure function that walks an account's Trade ledger once and emits the
 * still-open positions. Pricing (mark-to-market) is the service layer's
 * job — this module only derives the *state* of the open book from fills,
 * the same way {@link ./fifo.ts} derives the closed-book matches.
 *
 * Long-only to mirror the rest of the PnL pipeline (NCN-20): buys build
 * open lots, sells consume them. Shorts are not produced by the current
 * runner and the FIFO matcher already warns when a sell exceeds the open
 * long position.
 */

import type { UnrealizedPnlSummary } from '@workspace/shared';
import type { FifoLogger, FifoTrade } from './fifo.js';

/** Internal: a single buy lot still waiting to be closed. */
interface OpenLot {
  qtyRemaining: number;
  /** Per-unit cost basis including allocated buy fee. */
  costPerUnit: number;
  /** ISO timestamp of the buy that opened this lot. */
  openedAt: string;
}

const EPSILON = 1e-9;

/** Buy-side fee per unit, treating `undefined` / `null` / zero-qty as 0. */
function unitFee(trade: FifoTrade): number {
  if (trade.qty <= 0) return 0;
  const fee = trade.fee ?? 0;
  return fee > 0 ? fee / trade.qty : 0;
}

/**
 * Walk `trades` (which the caller must sort ascending by `(timestamp, id)`,
 * same convention as the FIFO matcher) and emit one entry per symbol whose
 * open qty is still > 0. Buys add a new lot; sells consume from the front
 * of the queue in FIFO order. The "oldest open lot's timestamp" tracks the
 * back of the queue (the lot no future sell has touched yet) — when a lot
 * is fully consumed, the next lot becomes the oldest open one.
 */
export function computeOpenPositions(
  accountId: string,
  trades: readonly FifoTrade[],
  options: { logger?: FifoLogger } = {},
): UnrealizedPnlSummary['positions'] {
  const logger = options.logger;
  // Per-symbol FIFO queue of open lots.
  const queueBySymbol = new Map<string, OpenLot[]>();

  for (const trade of trades) {
    if (trade.side === 'buy') {
      const buyFeePerUnit = unitFee(trade);
      const lot: OpenLot = {
        qtyRemaining: trade.qty,
        costPerUnit: trade.price + buyFeePerUnit,
        openedAt: trade.timestamp,
      };
      const queue = queueBySymbol.get(trade.symbol) ?? [];
      queue.push(lot);
      queueBySymbol.set(trade.symbol, queue);
      continue;
    }

    // side === 'sell' — consume from the front of the queue.
    const queue = queueBySymbol.get(trade.symbol);
    let qtyToClose = trade.qty;
    if (queue === undefined || queue.length === 0) {
      logger?.warn(
        `Open-position walk: sell ${trade.id} for ${trade.symbol} has no open position; qty=${trade.qty} ignored`,
      );
      continue;
    }
    while (qtyToClose > EPSILON && queue.length > 0) {
      const front = queue[0]!;
      const take = Math.min(qtyToClose, front.qtyRemaining);
      front.qtyRemaining -= take;
      qtyToClose -= take;
      if (front.qtyRemaining <= EPSILON) {
        queue.shift();
      }
    }
    if (qtyToClose > EPSILON) {
      logger?.warn(
        `Open-position walk: sell ${trade.id} for ${trade.symbol} exceeds open position by ${formatQty(qtyToClose)}; clamping`,
      );
    }
  }

  // Build the per-symbol snapshot from whatever is still in the queue.
  const positions: UnrealizedPnlSummary['positions'] = [];
  for (const [symbol, queue] of queueBySymbol) {
    let totalQty = 0;
    let totalCost = 0;
    let oldestOpenedAt: string | null = null;
    for (const lot of queue) {
      if (lot.qtyRemaining <= EPSILON) continue;
      totalQty += lot.qtyRemaining;
      totalCost += lot.qtyRemaining * lot.costPerUnit;
      if (oldestOpenedAt === null || lot.openedAt < oldestOpenedAt) {
        oldestOpenedAt = lot.openedAt;
      }
    }
    if (totalQty <= EPSILON || oldestOpenedAt === null) continue;
    positions.push({
      accountId,
      symbol,
      side: 'buy',
      qty: totalQty,
      avgEntryPrice: totalCost / totalQty,
      // Pricing lives in the service layer; the pure function returns the
      // deterministic state the service needs to mark to market.
      markPrice: null,
      unrealizedPnl: null,
      pricedAt: null,
      openedAt: oldestOpenedAt,
    });
  }

  // Stable ordering — by symbol alphabetically — keeps endpoint responses
  // deterministic so the UI doesn't reshuffle on every refresh.
  positions.sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
  return positions;
}

function formatQty(qty: number): string {
  return qty.toFixed(8).replace(/\.?0+$/, '');
}
