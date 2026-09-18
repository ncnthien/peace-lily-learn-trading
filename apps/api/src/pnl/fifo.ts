/**
 * FIFO realized-PnL matcher (NCN-20).
 *
 * Pure function: takes a chronologically-sorted list of trades (asc by
 * timestamp, then id for tie-break) and produces one {@link RealizedPnlMatch}
 * per sell that consumed any quantity from the open position.
 *
 * Long-only: shorts are out of scope for the demo flow. A sell that exceeds
 * the open long position is clamped at the available quantity and a warning
 * is emitted via the optional `logger` so the caller can surface it. A sell
 * with no open position at all produces no match.
 *
 * Fee handling:
 *   - buy  `costPerUnit = price + fee/buyQty`  (fee/0 is guarded)
 *   - sell `proceedsPerUnit = price - fee/sellQty` (per matched unit)
 *   - matchedBuys keeps each consumed lot's `costPerUnit` so the API can
 *     show the basis breakdown, not a blended average.
 *
 * The matcher does NOT look up live prices, does NOT mutate its input,
 * and does NOT touch the database. Caller is responsible for loading
 * trades in the right order.
 */

import type { RealizedPnlMatch } from '@workspace/shared';

export interface FifoTrade {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  price: number;
  qty: number;
  /** Optional fee in quote currency. Treat `undefined` as 0 for legacy rows. */
  fee?: number | null;
  /** ISO timestamp; compared lexicographically after sorting. */
  timestamp: string;
}

export interface FifoLogger {
  warn: (msg: string) => void;
}

/** Internal: a single buy lot waiting to be closed. */
interface OpenLot {
  buyTradeId: string;
  qtyRemaining: number;
  costPerUnit: number;
}

const EPSILON = 1e-9;

/**
 * Run the FIFO matcher over a chronologically-sorted list of trades.
 *
 * `trades` MUST be sorted ascending by `(timestamp, id)` — the caller is
 * responsible for ordering. The matcher relies on that ordering for both
 * FIFO fairness and stable tie-breaks.
 *
 * Returns one entry per sell that closed ≥ 1 unit, in the same order the
 * sells appeared in the input. Buys alone (no sells) yield an empty array.
 */
export function matchRealizedPnl(
  trades: readonly FifoTrade[],
  options: { logger?: FifoLogger } = {},
): RealizedPnlMatch[] {
  const logger = options.logger;
  // Open lots keyed by symbol. Sells never enter the queue — they're
  // consumption events that walk the queue from the front.
  const openBySymbol = new Map<string, OpenLot[]>();
  const matches: RealizedPnlMatch[] = [];

  for (const trade of trades) {
    if (trade.side === 'buy') {
      const buyFeePerUnit = unitFee(trade);
      const lot: OpenLot = {
        buyTradeId: trade.id,
        qtyRemaining: trade.qty,
        costPerUnit: trade.price + buyFeePerUnit,
      };
      const queue = openBySymbol.get(trade.symbol) ?? [];
      queue.push(lot);
      openBySymbol.set(trade.symbol, queue);
      continue;
    }

    // side === 'sell'
    const queue = openBySymbol.get(trade.symbol);
    let qtyToClose = trade.qty;
    if (queue === undefined || queue.length === 0) {
      logger?.warn(
        `PnL FIFO: sell ${trade.id} for ${trade.symbol} has no open position; ` +
          `qty=${trade.qty} ignored`,
      );
      continue;
    }

    const sellFeePerUnit = unitFee(trade);
    const matchedBuys: RealizedPnlMatch['matchedBuys'] = [];
    let realizedPnl = 0;
    const proceedsPerUnit = trade.price - sellFeePerUnit;

    while (qtyToClose > EPSILON && queue.length > 0) {
      const front = queue[0]!;
      const take = Math.min(qtyToClose, front.qtyRemaining);
      matchedBuys.push({
        buyTradeId: front.buyTradeId,
        qty: take,
        costPerUnit: front.costPerUnit,
      });
      realizedPnl += take * (proceedsPerUnit - front.costPerUnit);
      front.qtyRemaining -= take;
      qtyToClose -= take;
      if (front.qtyRemaining <= EPSILON) {
        queue.shift();
      }
    }

    if (qtyToClose > EPSILON) {
      logger?.warn(
        `PnL FIFO: sell ${trade.id} for ${trade.symbol} exceeds open position by ` +
          `${formatQty(qtyToClose)}; clamping match to available quantity`,
      );
    }

    const totalMatched = matchedBuys.reduce((sum, m) => sum + m.qty, 0);
    matches.push({
      sellTradeId: trade.id,
      sellTimestamp: trade.timestamp,
      symbol: trade.symbol,
      qty: totalMatched,
      realizedPnl,
      sellFeePerUnit,
      matchedBuys,
    });
  }

  return matches;
}

/** `fee / qty`; treats undefined/null/0-qty as 0. */
function unitFee(trade: FifoTrade): number {
  if (trade.qty <= 0) return 0;
  const fee = trade.fee ?? 0;
  return fee > 0 ? fee / trade.qty : 0;
}

function formatQty(qty: number): string {
  return qty.toFixed(8).replace(/\.?0+$/, '');
}

/**
 * Sort trades ascending by `(timestamp, id)`. Exposed so callers can
 * normalize once even if they pull in a slightly different shape.
 */
export function sortTradesForFifo<T extends { timestamp: string; id: string }>(
  trades: readonly T[],
): T[] {
  return [...trades].sort((a, b) => {
    if (a.timestamp === b.timestamp) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    return a.timestamp < b.timestamp ? -1 : 1;
  });
}