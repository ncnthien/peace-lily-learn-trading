import { matchRealizedPnl, sortTradesForFifo } from './fifo.js';
import type { FifoLogger, FifoTrade } from './fifo.js';

/**
 * FIFO matcher tests (NCN-20).
 *
 * Pure-function tests — no DB, no Nest. The matcher is deterministic on
 * the (timestamp, id) sort order, so we hand-build chronologically-sorted
 * inputs and assert on the resulting `RealizedPnlMatch[]`.
 */

const t = (iso: string): string => iso; // readability

function silentLogger(): { warn: ReturnType<typeof vi.fn> } & FifoLogger {
  return { warn: vi.fn() };
}

describe('matchRealizedPnl (FIFO matcher)', () => {
  it('returns no matches when there are only buys', () => {
    const trades: FifoTrade[] = [
      { id: 'b1', symbol: 'BTCUSDT', side: 'buy', price: 100, qty: 1, timestamp: t('2026-01-01T00:00:00Z') },
    ];
    expect(matchRealizedPnl(trades)).toEqual([]);
  });

  it('returns no matches for an empty input', () => {
    expect(matchRealizedPnl([])).toEqual([]);
  });

  it('computes a simple buy-then-sell profit', () => {
    const trades: FifoTrade[] = [
      { id: 'b1', symbol: 'BTCUSDT', side: 'buy', price: 100, qty: 1, timestamp: t('2026-01-01T00:00:00Z') },
      { id: 's1', symbol: 'BTCUSDT', side: 'sell', price: 150, qty: 1, timestamp: t('2026-01-02T00:00:00Z') },
    ];
    const matches = matchRealizedPnl(trades);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      sellTradeId: 's1',
      symbol: 'BTCUSDT',
      qty: 1,
      realizedPnl: 50,
      sellFeePerUnit: 0,
      matchedBuys: [{ buyTradeId: 'b1', qty: 1, costPerUnit: 100 }],
    });
  });

  it('handles a partial close (sell < open position)', () => {
    const trades: FifoTrade[] = [
      { id: 'b1', symbol: 'BTCUSDT', side: 'buy', price: 100, qty: 1, timestamp: t('2026-01-01T00:00:00Z') },
      { id: 's1', symbol: 'BTCUSDT', side: 'sell', price: 150, qty: 0.3, timestamp: t('2026-01-02T00:00:00Z') },
    ];
    const matches = matchRealizedPnl(trades);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.qty).toBe(0.3);
    expect(matches[0]?.realizedPnl).toBeCloseTo(15, 9);
    expect(matches[0]?.matchedBuys).toEqual([
      { buyTradeId: 'b1', qty: 0.3, costPerUnit: 100 },
    ]);
  });

  it('walks FIFO across multiple buy lots', () => {
    const trades: FifoTrade[] = [
      { id: 'b1', symbol: 'BTCUSDT', side: 'buy', price: 100, qty: 0.1, timestamp: t('2026-01-01T00:00:00Z') },
      { id: 'b2', symbol: 'BTCUSDT', side: 'buy', price: 200, qty: 0.2, timestamp: t('2026-01-02T00:00:00Z') },
      { id: 's1', symbol: 'BTCUSDT', side: 'sell', price: 250, qty: 0.25, timestamp: t('2026-01-03T00:00:00Z') },
    ];
    const matches = matchRealizedPnl(trades);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.matchedBuys).toEqual([
      { buyTradeId: 'b1', qty: 0.1, costPerUnit: 100 }, // FIFO: oldest consumed first
      { buyTradeId: 'b2', qty: 0.15, costPerUnit: 200 },
    ]);
    expect(matches[0]?.qty).toBeCloseTo(0.25, 9);
    // 0.1 * (250 - 100) + 0.15 * (250 - 200) = 15 + 7.5 = 22.5
    expect(matches[0]?.realizedPnl).toBeCloseTo(22.5, 9);
  });

  it('keeps separate FIFO queues per symbol', () => {
    const trades: FifoTrade[] = [
      { id: 'b1', symbol: 'BTCUSDT', side: 'buy', price: 100, qty: 1, timestamp: t('2026-01-01T00:00:00Z') },
      { id: 'b2', symbol: 'ETHUSDT', side: 'buy', price: 1000, qty: 5, timestamp: t('2026-01-01T00:01:00Z') },
      { id: 's1', symbol: 'BTCUSDT', side: 'sell', price: 120, qty: 1, timestamp: t('2026-01-02T00:00:00Z') },
      { id: 's2', symbol: 'ETHUSDT', side: 'sell', price: 900, qty: 5, timestamp: t('2026-01-02T00:01:00Z') },
    ];
    const matches = matchRealizedPnl(trades);
    expect(matches).toHaveLength(2);
    expect(matches[0]?.symbol).toBe('BTCUSDT');
    expect(matches[0]?.realizedPnl).toBeCloseTo(20, 9);
    expect(matches[1]?.symbol).toBe('ETHUSDT');
    expect(matches[1]?.realizedPnl).toBeCloseTo(-500, 9);
  });

  it('clamps a sell that exceeds the open position and warns', () => {
    const logger = silentLogger();
    const trades: FifoTrade[] = [
      { id: 'b1', symbol: 'BTCUSDT', side: 'buy', price: 100, qty: 0.3, timestamp: t('2026-01-01T00:00:00Z') },
      { id: 's1', symbol: 'BTCUSDT', side: 'sell', price: 150, qty: 1, timestamp: t('2026-01-02T00:00:00Z') },
    ];
    const matches = matchRealizedPnl(trades, { logger });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.qty).toBeCloseTo(0.3, 9); // clamped to available
    expect(matches[0]?.realizedPnl).toBeCloseTo(15, 9);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('skips a sell with no open position and warns', () => {
    const logger = silentLogger();
    const trades: FifoTrade[] = [
      { id: 's1', symbol: 'BTCUSDT', side: 'sell', price: 150, qty: 1, timestamp: t('2026-01-01T00:00:00Z') },
    ];
    expect(matchRealizedPnl(trades, { logger })).toEqual([]);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('does not warn when the sell exactly matches the open position', () => {
    const logger = silentLogger();
    const trades: FifoTrade[] = [
      { id: 'b1', symbol: 'BTCUSDT', side: 'buy', price: 100, qty: 1, timestamp: t('2026-01-01T00:00:00Z') },
      { id: 's1', symbol: 'BTCUSDT', side: 'sell', price: 100, qty: 1, timestamp: t('2026-01-02T00:00:00Z') },
    ];
    matchRealizedPnl(trades, { logger });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('applies buy fees into cost basis (costPerUnit = price + fee/qty)', () => {
    // Buy 1 @ 100 fee 10 → costPerUnit = 110
    // Sell 1 @ 150 fee 0  → proceedsPerUnit = 150 → pnl = 40
    const trades: FifoTrade[] = [
      {
        id: 'b1',
        symbol: 'BTCUSDT',
        side: 'buy',
        price: 100,
        qty: 1,
        fee: 10,
        timestamp: t('2026-01-01T00:00:00Z'),
      },
      {
        id: 's1',
        symbol: 'BTCUSDT',
        side: 'sell',
        price: 150,
        qty: 1,
        fee: 0,
        timestamp: t('2026-01-02T00:00:00Z'),
      },
    ];
    const matches = matchRealizedPnl(trades);
    expect(matches[0]?.matchedBuys[0]?.costPerUnit).toBeCloseTo(110, 9);
    expect(matches[0]?.realizedPnl).toBeCloseTo(40, 9);
  });

  it('subtracts sell fees from proceeds (proceedsPerUnit = price - fee/qty)', () => {
    // Buy 1 @ 100 fee 0  → costPerUnit = 100
    // Sell 1 @ 150 fee 10 → proceedsPerUnit = 140 → pnl = 40
    const trades: FifoTrade[] = [
      {
        id: 'b1',
        symbol: 'BTCUSDT',
        side: 'buy',
        price: 100,
        qty: 1,
        fee: 0,
        timestamp: t('2026-01-01T00:00:00Z'),
      },
      {
        id: 's1',
        symbol: 'BTCUSDT',
        side: 'sell',
        price: 150,
        qty: 1,
        fee: 10,
        timestamp: t('2026-01-02T00:00:00Z'),
      },
    ];
    const matches = matchRealizedPnl(trades);
    expect(matches[0]?.sellFeePerUnit).toBeCloseTo(10, 9);
    expect(matches[0]?.realizedPnl).toBeCloseTo(40, 9);
  });

  it('applies both buy and sell fees symmetrically', () => {
    // Buy 1 @ 100 fee 10 → costPerUnit = 110
    // Sell 1 @ 150 fee 10 → proceedsPerUnit = 140 → pnl = 30
    const trades: FifoTrade[] = [
      {
        id: 'b1',
        symbol: 'BTCUSDT',
        side: 'buy',
        price: 100,
        qty: 1,
        fee: 10,
        timestamp: t('2026-01-01T00:00:00Z'),
      },
      {
        id: 's1',
        symbol: 'BTCUSDT',
        side: 'sell',
        price: 150,
        qty: 1,
        fee: 10,
        timestamp: t('2026-01-02T00:00:00Z'),
      },
    ];
    const matches = matchRealizedPnl(trades);
    expect(matches[0]?.matchedBuys[0]?.costPerUnit).toBeCloseTo(110, 9);
    expect(matches[0]?.sellFeePerUnit).toBeCloseTo(10, 9);
    expect(matches[0]?.realizedPnl).toBeCloseTo(30, 9);
  });

  it('allocates sell fees proportionally when one sell closes multiple buys', () => {
    // Buy 1 @ 100 fee 0, qty 1, costPerUnit 100
    // Buy 1 @ 200 fee 0, qty 1, costPerUnit 200
    // Sell 1 @ 250 fee 20 → proceedsPerUnit = 250 - 20 = 230 → pnl = 30 + 30 = 60
    //   matchedBuys: { b1, qty 1, costPerUnit 100 } + { b2, qty 0, ... } — only consumes b1
    // Adjust: sell qty 2 fee 40 → proceedsPerUnit = 250 - 20 = 230 → pnl = (230-100)+(230-200) = 160
    const trades: FifoTrade[] = [
      { id: 'b1', symbol: 'BTCUSDT', side: 'buy', price: 100, qty: 1, fee: 0, timestamp: t('2026-01-01T00:00:00Z') },
      { id: 'b2', symbol: 'BTCUSDT', side: 'buy', price: 200, qty: 1, fee: 0, timestamp: t('2026-01-02T00:00:00Z') },
      { id: 's1', symbol: 'BTCUSDT', side: 'sell', price: 250, qty: 2, fee: 40, timestamp: t('2026-01-03T00:00:00Z') },
    ];
    const matches = matchRealizedPnl(trades);
    expect(matches[0]?.matchedBuys).toHaveLength(2);
    expect(matches[0]?.sellFeePerUnit).toBeCloseTo(20, 9);
    expect(matches[0]?.realizedPnl).toBeCloseTo(160, 9);
  });

  it('treats undefined fee as 0 (legacy rows)', () => {
    const trades: FifoTrade[] = [
      { id: 'b1', symbol: 'BTCUSDT', side: 'buy', price: 100, qty: 1, timestamp: t('2026-01-01T00:00:00Z') },
      { id: 's1', symbol: 'BTCUSDT', side: 'sell', price: 120, qty: 1, timestamp: t('2026-01-02T00:00:00Z') },
    ];
    const matches = matchRealizedPnl(trades);
    expect(matches[0]?.sellFeePerUnit).toBe(0);
    expect(matches[0]?.realizedPnl).toBeCloseTo(20, 9);
  });

  it('treats null fee as 0', () => {
    const trades: FifoTrade[] = [
      { id: 'b1', symbol: 'BTCUSDT', side: 'buy', price: 100, qty: 1, fee: null, timestamp: t('2026-01-01T00:00:00Z') },
      { id: 's1', symbol: 'BTCUSDT', side: 'sell', price: 120, qty: 1, fee: null, timestamp: t('2026-01-02T00:00:00Z') },
    ];
    expect(matchRealizedPnl(trades)[0]?.realizedPnl).toBeCloseTo(20, 9);
  });

  it('produces multiple matches when sells are interleaved', () => {
    const trades: FifoTrade[] = [
      { id: 'b1', symbol: 'BTCUSDT', side: 'buy', price: 100, qty: 1, timestamp: t('2026-01-01T00:00:00Z') },
      { id: 's1', symbol: 'BTCUSDT', side: 'sell', price: 120, qty: 0.4, timestamp: t('2026-01-02T00:00:00Z') },
      { id: 's2', symbol: 'BTCUSDT', side: 'sell', price: 140, qty: 0.6, timestamp: t('2026-01-03T00:00:00Z') },
    ];
    const matches = matchRealizedPnl(trades);
    expect(matches).toHaveLength(2);
    expect(matches[0]?.sellTradeId).toBe('s1');
    expect(matches[0]?.realizedPnl).toBeCloseTo(8, 9);
    expect(matches[1]?.sellTradeId).toBe('s2');
    expect(matches[1]?.realizedPnl).toBeCloseTo(24, 9);
  });

  it('emits one match per sell in chronological order', () => {
    const trades: FifoTrade[] = [
      { id: 'b1', symbol: 'BTCUSDT', side: 'buy', price: 100, qty: 5, timestamp: t('2026-01-01T00:00:00Z') },
      { id: 's1', symbol: 'BTCUSDT', side: 'sell', price: 110, qty: 1, timestamp: t('2026-01-02T00:00:00Z') },
      { id: 's2', symbol: 'BTCUSDT', side: 'sell', price: 130, qty: 2, timestamp: t('2026-01-03T00:00:00Z') },
      { id: 's3', symbol: 'BTCUSDT', side: 'sell', price: 90, qty: 1, timestamp: t('2026-01-04T00:00:00Z') },
    ];
    const matches = matchRealizedPnl(trades);
    expect(matches.map((m) => m.sellTradeId)).toEqual(['s1', 's2', 's3']);
    expect(matches.map((m) => m.realizedPnl)).toEqual([10, 60, -10]);
  });
});

describe('sortTradesForFifo', () => {
  it('sorts by (timestamp asc, id asc)', () => {
    const trades: FifoTrade[] = [
      { id: 'c', symbol: 'BTCUSDT', side: 'buy', price: 1, qty: 1, timestamp: t('2026-01-02T00:00:00Z') },
      { id: 'a', symbol: 'BTCUSDT', side: 'buy', price: 1, qty: 1, timestamp: t('2026-01-01T00:00:00Z') },
      { id: 'b', symbol: 'BTCUSDT', side: 'buy', price: 1, qty: 1, timestamp: t('2026-01-01T00:00:00Z') },
    ];
    const sorted = sortTradesForFifo(trades);
    expect(sorted.map((tr) => tr.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input array', () => {
    const trades: FifoTrade[] = [
      { id: 'b', symbol: 'BTCUSDT', side: 'buy', price: 1, qty: 1, timestamp: t('2026-01-02T00:00:00Z') },
      { id: 'a', symbol: 'BTCUSDT', side: 'buy', price: 1, qty: 1, timestamp: t('2026-01-01T00:00:00Z') },
    ];
    sortTradesForFifo(trades);
    expect(trades.map((t2) => t2.id)).toEqual(['b', 'a']);
  });
});