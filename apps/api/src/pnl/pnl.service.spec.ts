import { PnlService } from './pnl.service.js';
import type { MarketDataSource } from '../market-data/market-data.types.js';

/**
 * PnlService tests (NCN-20 + NCN-21).
 *
 * Prisma is mocked with the minimum surface the service uses
 * (`trade.findMany`). The matcher itself is covered by fifo.spec.ts;
 * here we focus on aggregation: totals, per-symbol, and the
 * empty-account fallback. The NCN-21 section uses an in-memory
 * MarketDataSource to verify the mark-to-market path without hitting
 * Binance.
 */

interface TradeRow {
  id: string;
  accountId: string;
  symbol: string;
  side: string;
  price: number;
  qty: number;
  fee: number | null;
  timestamp: Date;
}

function makePrismaMock(trades: TradeRow[]) {
  return {
    trade: {
      findMany: vi.fn(
        async (args: {
          where: { accountId: string };
          orderBy: ReadonlyArray<Record<string, 'asc' | 'desc'>>;
        }) => {
          const accountTrades = trades
            .filter((t) => t.accountId === args.where.accountId)
            .sort((a, b) => {
              const cmp = a.timestamp.getTime() - b.timestamp.getTime();
              if (cmp !== 0) return cmp;
              return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
            });
          return accountTrades.map((t) => ({
            id: t.id,
            accountId: t.accountId,
            symbol: t.symbol,
            side: t.side,
            price: t.price,
            qty: t.qty,
            fee: t.fee,
            timestamp: t.timestamp,
          }));
        },
      ),
    },
  };
}

/**
 * Minimal MarketDataSource stub for tests — only `getLatestPrice` is
 * exercised by the unrealized path. Other methods throw on call to
 * surface accidental reliance on them.
 */
function makeMarketDataMock(
  prices: Record<string, number>,
): MarketDataSource & { calls: Array<{ symbol: string }> } {
  const calls: Array<{ symbol: string }> = [];
  return {
    calls,
    async getLatestPrice(input) {
      calls.push({ symbol: input.symbol });
      return prices[input.symbol] ?? null;
    },
    async getCandles() {
      throw new Error('getCandles not stubbed');
    },
    subscribe() {
      throw new Error('subscribe not stubbed');
    },
    shutdown() {
      /* no-op */
    },
  } as unknown as MarketDataSource & { calls: Array<{ symbol: string }> };
}

describe('PnlService (NCN-20)', () => {
  it('returns empty matches for an account with no trades', async () => {
    const prisma = makePrismaMock([]);
    const marketData = makeMarketDataMock({});
    const service = new PnlService(
      prisma as unknown as ConstructorParameters<typeof PnlService>[0],
      marketData as unknown as ConstructorParameters<typeof PnlService>[1],
    );
    const matches = await service.listMatches('acc-1');
    expect(matches).toEqual([]);
  });

  it('returns an empty summary (zeros, empty maps) for an account with no trades', async () => {
    const prisma = makePrismaMock([]);
    const marketData = makeMarketDataMock({});
    const service = new PnlService(
      prisma as unknown as ConstructorParameters<typeof PnlService>[0],
      marketData as unknown as ConstructorParameters<typeof PnlService>[1],
    );
    const summary = await service.getSummary('acc-1');
    expect(summary).toEqual({
      accountId: 'acc-1',
      totalRealizedPnl: 0,
      perSymbol: {},
      matches: [],
    });
  });

  it('aggregates totalRealizedPnl across multiple matches and symbols', async () => {
    const base = Date.now();
    const prisma = makePrismaMock([
      { id: 'b1', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'buy', price: 100, qty: 1, fee: null, timestamp: new Date(base) },
      { id: 's1', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'sell', price: 110, qty: 1, fee: null, timestamp: new Date(base + 1) },
      { id: 'b2', accountId: 'acc-1', symbol: 'ETHUSDT', side: 'buy', price: 1000, qty: 2, fee: null, timestamp: new Date(base + 2) },
      { id: 's2', accountId: 'acc-1', symbol: 'ETHUSDT', side: 'sell', price: 1200, qty: 1, fee: null, timestamp: new Date(base + 3) },
    ]);
    const marketData = makeMarketDataMock({});
    const service = new PnlService(
      prisma as unknown as ConstructorParameters<typeof PnlService>[0],
      marketData as unknown as ConstructorParameters<typeof PnlService>[1],
    );
    const summary = await service.getSummary('acc-1');
    // BTCUSDT: 1 * (110 - 100) = 10
    // ETHUSDT: 1 * (1200 - 1000) = 200
    expect(summary.totalRealizedPnl).toBeCloseTo(210, 9);
    expect(summary.perSymbol).toEqual({
      BTCUSDT: 10,
      ETHUSDT: 200,
    });
    expect(summary.matches).toHaveLength(2);
  });

  it('filters trades by accountId', async () => {
    const base = Date.now();
    const prisma = makePrismaMock([
      { id: 'b1', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'buy', price: 100, qty: 1, fee: null, timestamp: new Date(base) },
      { id: 's1', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'sell', price: 110, qty: 1, fee: null, timestamp: new Date(base + 1) },
      // Different account — must be ignored.
      { id: 'b2', accountId: 'acc-2', symbol: 'BTCUSDT', side: 'buy', price: 100, qty: 1, fee: null, timestamp: new Date(base + 2) },
      { id: 's2', accountId: 'acc-2', symbol: 'BTCUSDT', side: 'sell', price: 999, qty: 1, fee: null, timestamp: new Date(base + 3) },
    ]);
    const marketData = makeMarketDataMock({});
    const service = new PnlService(
      prisma as unknown as ConstructorParameters<typeof PnlService>[0],
      marketData as unknown as ConstructorParameters<typeof PnlService>[1],
    );
    const summary = await service.getSummary('acc-1');
    expect(summary.accountId).toBe('acc-1');
    expect(summary.totalRealizedPnl).toBeCloseTo(10, 9);
    expect(summary.matches).toHaveLength(1);
  });

  it('listMatches returns the per-trade breakdown in chronological order', async () => {
    const base = Date.now();
    const prisma = makePrismaMock([
      { id: 'b1', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'buy', price: 100, qty: 2, fee: null, timestamp: new Date(base) },
      { id: 's1', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'sell', price: 110, qty: 1, fee: null, timestamp: new Date(base + 1) },
      { id: 's2', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'sell', price: 120, qty: 1, fee: null, timestamp: new Date(base + 2) },
    ]);
    const marketData = makeMarketDataMock({});
    const service = new PnlService(
      prisma as unknown as ConstructorParameters<typeof PnlService>[0],
      marketData as unknown as ConstructorParameters<typeof PnlService>[1],
    );
    const matches = await service.listMatches('acc-1');
    expect(matches.map((m) => m.sellTradeId)).toEqual(['s1', 's2']);
    expect(matches.map((m) => m.realizedPnl)).toEqual([10, 20]);
  });
});

describe('PnlService (NCN-21: unrealized)', () => {
  it('returns an empty positions list for an account with no trades', async () => {
    const prisma = makePrismaMock([]);
    const marketData = makeMarketDataMock({});
    const service = new PnlService(
      prisma as unknown as ConstructorParameters<typeof PnlService>[0],
      marketData as unknown as ConstructorParameters<typeof PnlService>[1],
    );
    const positions = await service.getUnrealizedPositions('acc-1');
    expect(positions).toEqual([]);
    // No mark fetches when the book is empty.
    expect(marketData.calls).toEqual([]);
  });

  it('marks each open position to the latest price from MarketDataSource', async () => {
    const base = Date.now();
    const prisma = makePrismaMock([
      { id: 'b1', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'buy', price: 100, qty: 2, fee: null, timestamp: new Date(base) },
      { id: 'b2', accountId: 'acc-1', symbol: 'ETHUSDT', side: 'buy', price: 1000, qty: 4, fee: null, timestamp: new Date(base + 1) },
    ]);
    const marketData = makeMarketDataMock({
      BTCUSDT: 150, //  +50 per unit, position qty=2 → +100
      ETHUSDT: 1100, // +100 per unit, qty=4 → +400
    });
    const service = new PnlService(
      prisma as unknown as ConstructorParameters<typeof PnlService>[0],
      marketData as unknown as ConstructorParameters<typeof PnlService>[1],
    );
    const positions = await service.getUnrealizedPositions('acc-1');
    expect(positions).toHaveLength(2);
    const btc = positions.find((p) => p.symbol === 'BTCUSDT')!;
    const eth = positions.find((p) => p.symbol === 'ETHUSDT')!;
    expect(btc.markPrice).toBe(150);
    expect(btc.unrealizedPnl).toBeCloseTo(100, 9);
    expect(btc.avgEntryPrice).toBe(100);
    expect(btc.qty).toBe(2);
    expect(eth.markPrice).toBe(1100);
    expect(eth.unrealizedPnl).toBeCloseTo(400, 9);
    expect(eth.pricedAt).toBeTruthy();
  });

  it('parallel-fetches marks for multiple held symbols in a single pass', async () => {
    const base = Date.now();
    const prisma = makePrismaMock([
      { id: 'b1', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'buy', price: 100, qty: 1, fee: null, timestamp: new Date(base) },
      { id: 'b2', accountId: 'acc-1', symbol: 'ETHUSDT', side: 'buy', price: 1000, qty: 1, fee: null, timestamp: new Date(base + 1) },
      { id: 'b3', accountId: 'acc-1', symbol: 'SOLUSDT', side: 'buy', price: 20, qty: 1, fee: null, timestamp: new Date(base + 2) },
    ]);
    const marketData = makeMarketDataMock({ BTCUSDT: 110, ETHUSDT: 1100, SOLUSDT: 22 });
    const service = new PnlService(
      prisma as unknown as ConstructorParameters<typeof PnlService>[0],
      marketData as unknown as ConstructorParameters<typeof PnlService>[1],
    );
    await service.getUnrealizedPositions('acc-1');
    // Three distinct symbols held → three MarketData lookups (parallelized,
    // but the order is whatever Promise.all resolves them in; we just
    // assert all three were requested).
    const symbols = marketData.calls.map((c) => c.symbol).sort();
    expect(symbols).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
  });

  it('nulls out markPrice + unrealizedPnl when MarketData has no quote', async () => {
    const base = Date.now();
    const prisma = makePrismaMock([
      { id: 'b1', accountId: 'acc-1', symbol: 'NEWUSDT', side: 'buy', price: 1, qty: 1, fee: null, timestamp: new Date(base) },
    ]);
    const marketData = makeMarketDataMock({}); // no quote
    const service = new PnlService(
      prisma as unknown as ConstructorParameters<typeof PnlService>[0],
      marketData as unknown as ConstructorParameters<typeof PnlService>[1],
    );
    const positions = await service.getUnrealizedPositions('acc-1');
    expect(positions).toHaveLength(1);
    expect(positions[0]!.markPrice).toBeNull();
    expect(positions[0]!.unrealizedPnl).toBeNull();
    expect(positions[0]!.pricedAt).toBeNull();
  });

  it('aggregates totalUnrealizedPnl + perSymbol skipping null-mark positions', async () => {
    const base = Date.now();
    const prisma = makePrismaMock([
      { id: 'b1', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'buy', price: 100, qty: 2, fee: null, timestamp: new Date(base) },
      { id: 'b2', accountId: 'acc-1', symbol: 'NEWUSDT', side: 'buy', price: 1, qty: 5, fee: null, timestamp: new Date(base + 1) },
    ]);
    const marketData = makeMarketDataMock({ BTCUSDT: 150 });
    const service = new PnlService(
      prisma as unknown as ConstructorParameters<typeof PnlService>[0],
      marketData as unknown as ConstructorParameters<typeof PnlService>[1],
    );
    const summary = await service.getUnrealizedSummary('acc-1');
    expect(summary.accountId).toBe('acc-1');
    // Only BTCUSDT contributes: qty 2 * (150 - 100) = 100.
    expect(summary.totalUnrealizedPnl).toBeCloseTo(100, 9);
    expect(summary.perSymbol).toEqual({ BTCUSDT: 100 });
    expect(summary.positions).toHaveLength(2);
  });
});

describe('PnlService.getPnlSeries (NCN-22)', () => {
  it('returns an empty series when the account has no trades', async () => {
    const prisma = makePrismaMock([]);
    const marketData = makeMarketDataMock({});
    const service = new PnlService(
      prisma as unknown as ConstructorParameters<typeof PnlService>[0],
      marketData as unknown as ConstructorParameters<typeof PnlService>[1],
    );
    const series = await service.getPnlSeries('acc-1', 'day');
    expect(series).toEqual([]);
  });

  it('returns an empty series when there are buys but no sells', async () => {
    const base = Date.now();
    const prisma = makePrismaMock([
      { id: 'b1', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'buy', price: 100, qty: 1, fee: null, timestamp: new Date(base) },
    ]);
    const marketData = makeMarketDataMock({});
    const service = new PnlService(
      prisma as unknown as ConstructorParameters<typeof PnlService>[0],
      marketData as unknown as ConstructorParameters<typeof PnlService>[1],
    );
    const series = await service.getPnlSeries('acc-1', 'day');
    expect(series).toEqual([]);
  });

  it('buckets closed-sell PnL by day across multiple sells', async () => {
    // Two buy lots, two sells the same UTC day:
    //   s1 @ 120 × 1 → matches b1 (cost 100)        =  20 realized
    //   s2 @ 150 × 2 → matches b1 rem (1@100) +
    //                              b2 (1@120)        =  50 + 30 = 80 realized
    //   total = 100
    const base = Date.UTC(2026, 0, 15, 12, 0, 0);
    const prisma = makePrismaMock([
      { id: 'b1', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'buy', price: 100, qty: 2, fee: null, timestamp: new Date(base - 60_000) },
      { id: 'b2', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'buy', price: 120, qty: 2, fee: null, timestamp: new Date(base - 30_000) },
      { id: 's1', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'sell', price: 120, qty: 1, fee: null, timestamp: new Date(base) },
      { id: 's2', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'sell', price: 150, qty: 2, fee: null, timestamp: new Date(base + 60_000) },
    ]);
    const marketData = makeMarketDataMock({});
    const service = new PnlService(
      prisma as unknown as ConstructorParameters<typeof PnlService>[0],
      marketData as unknown as ConstructorParameters<typeof PnlService>[1],
    );
    const series = await service.getPnlSeries('acc-1', 'day');
    expect(series).toEqual([{ bucketStart: '2026-01-15', pnl: 100 }]);
  });

  it('honors the bucket choice: same data yields different keys for week vs day', async () => {
    const base = Date.UTC(2026, 0, 15, 12, 0, 0); // Thursday
    const prisma = makePrismaMock([
      { id: 'b1', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'buy', price: 100, qty: 2, fee: null, timestamp: new Date(base - 60_000) },
      { id: 's1', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'sell', price: 120, qty: 1, fee: null, timestamp: new Date(base) },
    ]);
    const marketData = makeMarketDataMock({});
    const service = new PnlService(
      prisma as unknown as ConstructorParameters<typeof PnlService>[0],
      marketData as unknown as ConstructorParameters<typeof PnlService>[1],
    );
    const daySeries = await service.getPnlSeries('acc-1', 'day');
    const weekSeries = await service.getPnlSeries('acc-1', 'week');
    const monthSeries = await service.getPnlSeries('acc-1', 'month');
    expect(daySeries[0]!.bucketStart).toBe('2026-01-15');
    expect(weekSeries[0]!.bucketStart).toBe('2026-01-12');
    expect(monthSeries[0]!.bucketStart).toBe('2026-01-01');
  });
});