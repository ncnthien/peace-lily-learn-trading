import { TradesService } from './trades.service.js';
import { MockOrderExecution } from '../order-execution/mock-order-execution.js';

interface TradeRow {
  id: string;
  accountId: string;
  symbol: string;
  side: string;
  price: number;
  qty: number;
  timestamp: Date;
  automationItemId: string | null;
}

interface AccountRow {
  id: string;
  type: string;
}

/**
 * Two-store Prisma mock: accounts are tracked separately from trades
 * because the service's `refreshSubscriptions` reads `account.findMany`
 * while `list()` / `trade.create` operate on the trade store.
 */
function makePrismaMock(opts: { accounts: AccountRow[]; trades: TradeRow[] }) {
  const tradeStore = new Map(opts.trades.map((t) => [t.id, t]));
  const accountStore = new Map(opts.accounts.map((a) => [a.id, a]));
  return {
    account: {
      findMany: vi.fn(
        async (args?: { where?: { type?: string; accountId?: string } }) => {
          let rows = Array.from(accountStore.values());
          if (args?.where?.type !== undefined) {
            rows = rows.filter((a) => a.type === args.where!.type);
          }
          return rows.map((a) => ({ id: a.id, type: a.type }));
        },
      ),
    },
    trade: {
      findMany: vi.fn(async (args: { where: { accountId: string }; orderBy?: unknown }) =>
        Array.from(tradeStore.values())
          .filter((r) => r.accountId === args.where.accountId)
          .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()),
      ),
      create: vi.fn(async (args: { data: Omit<TradeRow, 'timestamp'> & { timestamp: Date } }) => {
        const row: TradeRow = { ...args.data };
        tradeStore.set(row.id, row);
        return row;
      }),
    },
  };
}

describe('TradesService (NCN-19)', () => {
  let orders: MockOrderExecution;
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: TradesService;

  beforeEach(() => {
    orders = new MockOrderExecution();
    orders.setFillPrice('BTCUSDT', 50_000);
    prisma = makePrismaMock({ accounts: [{ id: 'acc-1', type: 'demo' }], trades: [] });
    service = new TradesService(
      prisma as unknown as ConstructorParameters<typeof TradesService>[0],
      orders,
    );
  });

  it('writes a Trade row when an automation-tagged order fills', async () => {
    await service.onModuleInit();

    const placed = await orders.placeOrder({
      accountId: 'acc-1',
      symbol: 'BTCUSDT',
      side: 'buy',
      qty: 0.01,
      automationItemId: 'item-42',
    });

    // Let the async subscribe callback run.
    await new Promise((resolve) => setImmediate(resolve));

    expect(placed.automationItemId).toBe('item-42');
    expect(prisma.trade.create).toHaveBeenCalledOnce();
    const trades = await service.list('acc-1');
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({
      accountId: 'acc-1',
      symbol: 'BTCUSDT',
      side: 'buy',
      price: 50_000,
      qty: 0.01,
      automationItemId: 'item-42',
    });
  });

  it('writes a Trade row without automationItemId for manual orders', async () => {
    await service.onModuleInit();

    await orders.placeOrder({
      accountId: 'acc-1',
      symbol: 'BTCUSDT',
      side: 'sell',
      qty: 0.5,
      // no automationItemId — manual order
    });
    await new Promise((resolve) => setImmediate(resolve));

    const trades = await service.list('acc-1');
    expect(trades).toHaveLength(1);
    expect(trades[0].automationItemId).toBeUndefined();
  });

  it('does NOT write a Trade for placed/cancelled/rejected events', async () => {
    await service.onModuleInit();

    await orders.placeOrder({ accountId: 'acc-1', symbol: 'BTCUSDT', side: 'buy', qty: 0.01 });
    await new Promise((resolve) => setImmediate(resolve));

    // placed + filled fire for one order; only filled writes a Trade.
    expect(prisma.trade.create).toHaveBeenCalledOnce();
  });

  it('rejected orders produce no Trade row', async () => {
    await service.onModuleInit();

    // qty=0 is invalid → mock emits `rejected` (no `filled`).
    await orders.placeOrder({ accountId: 'acc-1', symbol: 'BTCUSDT', side: 'buy', qty: 0 });
    await new Promise((resolve) => setImmediate(resolve));

    expect(prisma.trade.create).not.toHaveBeenCalled();
  });

  it('list returns trades newest first', async () => {
    const base = Date.now();
    prisma = makePrismaMock({
      accounts: [{ id: 'acc-1', type: 'demo' }],
      trades: [
        { id: 't1', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'buy', price: 50_000, qty: 0.01, timestamp: new Date(base - 200), automationItemId: null },
        { id: 't2', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'buy', price: 51_000, qty: 0.02, timestamp: new Date(base - 100), automationItemId: 'item-1' },
        { id: 't3', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'sell', price: 52_000, qty: 0.03, timestamp: new Date(base), automationItemId: null },
      ],
    });
    service = new TradesService(
      prisma as unknown as ConstructorParameters<typeof TradesService>[0],
      orders,
    );
    await service.onModuleInit();

    const trades = await service.list('acc-1');
    expect(trades.map((t) => t.id)).toEqual(['t3', 't2', 't1']);
  });

  it('list filters by accountId (no cross-account leakage)', async () => {
    prisma = makePrismaMock({
      accounts: [
        { id: 'acc-1', type: 'demo' },
        { id: 'acc-2', type: 'demo' },
      ],
      trades: [
        { id: 't1', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'buy', price: 50_000, qty: 0.01, timestamp: new Date(), automationItemId: null },
        { id: 't2', accountId: 'acc-2', symbol: 'BTCUSDT', side: 'buy', price: 50_000, qty: 0.01, timestamp: new Date(), automationItemId: null },
      ],
    });
    service = new TradesService(
      prisma as unknown as ConstructorParameters<typeof TradesService>[0],
      orders,
    );
    await service.onModuleInit();

    const a = await service.list('acc-1');
    const b = await service.list('acc-2');
    expect(a.map((t) => t.id)).toEqual(['t1']);
    expect(b.map((t) => t.id)).toEqual(['t2']);
  });

  it('onModuleDestroy cleans up subscriptions', async () => {
    await service.onModuleInit();

    await service.onModuleDestroy();
    // After destroy, a fresh account fill should not produce a Trade
    // (subscription torn down).
    await orders.placeOrder({ accountId: 'acc-1', symbol: 'BTCUSDT', side: 'buy', qty: 0.01 });
    await new Promise((resolve) => setImmediate(resolve));
    expect(prisma.trade.create).not.toHaveBeenCalled();
  });

  it('only subscribes for demo accounts (real accounts are ignored)', async () => {
    prisma = makePrismaMock({
      accounts: [
        { id: 'real-1', type: 'real' },
        { id: 'demo-1', type: 'demo' },
      ],
      trades: [],
    });
    service = new TradesService(
      prisma as unknown as ConstructorParameters<typeof TradesService>[0],
      orders,
    );
    await service.onModuleInit();

    // Real account: no Trade recorded.
    await orders.placeOrder({ accountId: 'real-1', symbol: 'BTCUSDT', side: 'buy', qty: 0.01 });
    await new Promise((resolve) => setImmediate(resolve));
    // Demo account: Trade recorded.
    await orders.placeOrder({ accountId: 'demo-1', symbol: 'BTCUSDT', side: 'buy', qty: 0.01 });
    await new Promise((resolve) => setImmediate(resolve));

    expect(prisma.trade.create).toHaveBeenCalledOnce();
    expect(prisma.trade.create.mock.calls[0]?.[0]?.data.accountId).toBe('demo-1');
  });
});
