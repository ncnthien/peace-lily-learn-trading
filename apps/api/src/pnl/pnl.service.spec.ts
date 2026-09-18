import { PnlService } from './pnl.service.js';

/**
 * PnlService tests (NCN-20).
 *
 * Prisma is mocked with the minimum surface the service uses
 * (`trade.findMany`). The matcher itself is covered by fifo.spec.ts;
 * here we focus on aggregation: totals, per-symbol, and the
 * empty-account fallback.
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

describe('PnlService (NCN-20)', () => {
  it('returns empty matches for an account with no trades', async () => {
    const prisma = makePrismaMock([]);
    const service = new PnlService(
      prisma as unknown as ConstructorParameters<typeof PnlService>[0],
    );
    const matches = await service.listMatches('acc-1');
    expect(matches).toEqual([]);
  });

  it('returns an empty summary (zeros, empty maps) for an account with no trades', async () => {
    const prisma = makePrismaMock([]);
    const service = new PnlService(
      prisma as unknown as ConstructorParameters<typeof PnlService>[0],
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
    const service = new PnlService(
      prisma as unknown as ConstructorParameters<typeof PnlService>[0],
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
    const service = new PnlService(
      prisma as unknown as ConstructorParameters<typeof PnlService>[0],
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
    const service = new PnlService(
      prisma as unknown as ConstructorParameters<typeof PnlService>[0],
    );
    const matches = await service.listMatches('acc-1');
    expect(matches.map((m) => m.sellTradeId)).toEqual(['s1', 's2']);
    expect(matches.map((m) => m.realizedPnl)).toEqual([10, 20]);
  });
});