import { TradesService } from './trades.service.js';
import { MockOrderExecution } from '../order-execution/mock-order-execution.js';

interface TradeRow {
  id: string;
  accountId: string;
  symbol: string;
  side: string;
  price: number;
  qty: number;
  fee: number | null;
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
interface TradeWhere {
  accountId?: string;
  automationItemId?: string | null | { not: null };
  timestamp?: { gte?: Date; lt?: Date };
  id?: { lt?: string };
}
/**
 * Prisma passes orderBy as an array of `{ field: 'asc' | 'desc' }`
 * entries, e.g. `[{ timestamp: 'desc' }, { id: 'desc' }]`.
 */
type OrderByEntry = Record<string, 'asc' | 'desc'>;
type OrderBy = OrderByEntry | OrderByEntry[];

function applyWhere(row: TradeRow, where: TradeWhere | undefined): boolean {
  if (where === undefined) return true;
  if (where.accountId !== undefined && row.accountId !== where.accountId) return false;
  if (where.automationItemId !== undefined) {
    const want = where.automationItemId;
    if (typeof want === 'string' && row.automationItemId !== want) return false;
    if (want === null && row.automationItemId !== null) return false;
    if (
      typeof want === 'object' &&
      want !== null &&
      'not' in want &&
      want.not === null &&
      row.automationItemId === null
    ) {
      return false;
    }
  }
  if (where.timestamp !== undefined) {
    const ts = row.timestamp.getTime();
    if (where.timestamp.gte !== undefined && ts < where.timestamp.gte.getTime()) return false;
    if (where.timestamp.lt !== undefined && ts >= where.timestamp.lt.getTime()) return false;
  }
  if (where.id !== undefined && where.id.lt !== undefined && row.id >= where.id.lt) {
    return false;
  }
  return true;
}

function compareByOrder(
  a: TradeRow,
  b: TradeRow,
  ob: OrderByEntry,
): number {
  for (const [field, dirRaw] of Object.entries(ob)) {
    const dir = dirRaw === 'desc' ? -1 : 1;
    if (field === 'timestamp') {
      const cmp = (a.timestamp.getTime() - b.timestamp.getTime()) * dir;
      if (cmp !== 0) return cmp;
    } else if (field === 'id') {
      if (a.id < b.id) return -1 * dir;
      if (a.id > b.id) return 1 * dir;
    }
  }
  return 0;
}

/**
 * Two-store Prisma mock: accounts are tracked separately from trades
 * because the service's `refreshSubscriptions` reads `account.findMany`
 * while `list()` / `listPage()` / `trade.create` operate on the trade store.
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
      findMany: vi.fn(
        async (args?: { where?: TradeWhere; orderBy?: OrderBy; take?: number }) => {
          let rows = Array.from(tradeStore.values()).filter((r) =>
            applyWhere(r, args?.where),
          );
          const orderBy = args?.orderBy;
          // Default sort is newest-first (preserves the NCN-19 behavior
          // for callers that don't supply orderBy).
          const effective: OrderByEntry[] =
            orderBy === undefined
              ? [{ timestamp: 'desc' }]
              : Array.isArray(orderBy)
                ? orderBy
                : [orderBy];
          rows.sort((a, b) => {
            for (const o of effective) {
              const cmp = compareByOrder(a, b, o);
              if (cmp !== 0) return cmp;
            }
            return 0;
          });
          if (args?.take !== undefined) rows = rows.slice(0, args.take);
          return rows;
        },
      ),
      create: vi.fn(async (args: { data: Omit<TradeRow, 'timestamp' | 'fee'> & { timestamp: Date; fee?: number | null } }) => {
        const row: TradeRow = { ...args.data, fee: args.data.fee ?? null };
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
        { id: 't1', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'buy', price: 50_000, qty: 0.01, fee: null, timestamp: new Date(base - 200), automationItemId: null },
        { id: 't2', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'buy', price: 51_000, qty: 0.02, fee: null, timestamp: new Date(base - 100), automationItemId: 'item-1' },
        { id: 't3', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'sell', price: 52_000, qty: 0.03, fee: null, timestamp: new Date(base), automationItemId: null },
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
        { id: 't1', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'buy', price: 50_000, qty: 0.01, fee: null, timestamp: new Date(), automationItemId: null },
        { id: 't2', accountId: 'acc-2', symbol: 'BTCUSDT', side: 'buy', price: 50_000, qty: 0.01, fee: null, timestamp: new Date(), automationItemId: null },
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

describe('TradesService.listPage (NCN-23)', () => {
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

  it('returns an empty page with null cursor when no trades exist', async () => {
    const page = await service.listPage({}, null, 50);
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it('orders items newest-first and attaches realizedPnl to closing sells', async () => {
    const base = Date.now();
    // Two buys, two sells. S1 closes 1 unit of B1, S2 closes the
    // remainder of B1 + all of B2. Net realized = (120-100)*1 + (150-100)*1 + (150-120)*2 = 20 + 50 + 60 = 130.
    const fixture = [
      { id: 'b1', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'buy', price: 100, qty: 2, fee: null, timestamp: new Date(base - 100), automationItemId: 'item-A' },
      { id: 'b2', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'buy', price: 120, qty: 2, fee: null, timestamp: new Date(base - 80), automationItemId: null },
      { id: 's1', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'sell', price: 120, qty: 1, fee: null, timestamp: new Date(base - 40), automationItemId: 'item-A' },
      { id: 's2', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'sell', price: 150, qty: 3, fee: null, timestamp: new Date(base - 10), automationItemId: null },
    ];
    prisma = makePrismaMock({ accounts: [{ id: 'acc-1', type: 'demo' }], trades: fixture });
    service = new TradesService(
      prisma as unknown as ConstructorParameters<typeof TradesService>[0],
      orders,
    );

    const page = await service.listPage({ accountId: 'acc-1' }, null, 50);
    expect(page.items.map((it) => it.id)).toEqual(['s2', 's1', 'b2', 'b1']);
    expect(page.nextCursor).toBeNull();
    const s2 = page.items.find((it) => it.id === 's2')!;
    const s1 = page.items.find((it) => it.id === 's1')!;
    expect(s2.realizedPnl).toBeCloseTo(110, 9); // 50 (1@b1) + 60 (2@b2)
    expect(s1.realizedPnl).toBeCloseTo(20, 9); // 1 unit @ cost 100
    const b1 = page.items.find((it) => it.id === 'b1')!;
    const b2 = page.items.find((it) => it.id === 'b2')!;
    expect(b1.realizedPnl).toBeNull();
    expect(b2.realizedPnl).toBeNull();
  });

  it('paginates: emits nextCursor when more rows exist; second page omits duplicates', async () => {
    const base = Date.now();
    const fixture = Array.from({ length: 7 }, (_, i) => ({
      id: `t${i + 1}`,
      accountId: 'acc-1',
      symbol: 'BTCUSDT',
      side: 'buy',
      price: 100,
      qty: 1,
      fee: null,
      // Oldest first; listPage sorts desc.
      timestamp: new Date(base + i),
      automationItemId: null,
    }));
    prisma = makePrismaMock({ accounts: [{ id: 'acc-1', type: 'demo' }], trades: fixture });
    service = new TradesService(
      prisma as unknown as ConstructorParameters<typeof TradesService>[0],
      orders,
    );

    const first = await service.listPage({ accountId: 'acc-1' }, null, 3);
    // Newest first: t7, t6, t5.
    expect(first.items.map((it) => it.id)).toEqual(['t7', 't6', 't5']);
    expect(first.nextCursor).toBe('t5');

    const second = await service.listPage({ accountId: 'acc-1' }, first.nextCursor, 3);
    // After t5 (cursor): t4, t3, t2.
    expect(second.items.map((it) => it.id)).toEqual(['t4', 't3', 't2']);
    expect(second.nextCursor).toBe('t2');

    const third = await service.listPage({ accountId: 'acc-1' }, second.nextCursor, 3);
    // After t2: just t1.
    expect(third.items.map((it) => it.id)).toEqual(['t1']);
    // No more rows → null cursor.
    expect(third.nextCursor).toBeNull();
  });

  it('filters by source=manual (drops any row with an automationItemId)', async () => {
    prisma = makePrismaMock({
      accounts: [{ id: 'acc-1', type: 'demo' }],
      trades: [
        { id: 'm1', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'buy', price: 1, qty: 1, fee: null, timestamp: new Date(1), automationItemId: null },
        { id: 'm2', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'buy', price: 1, qty: 1, fee: null, timestamp: new Date(2), automationItemId: 'item-1' },
        { id: 'm3', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'buy', price: 1, qty: 1, fee: null, timestamp: new Date(3), automationItemId: null },
      ],
    });
    service = new TradesService(
      prisma as unknown as ConstructorParameters<typeof TradesService>[0],
      orders,
    );
    const page = await service.listPage({ accountId: 'acc-1', source: 'manual' }, null, 50);
    expect(page.items.map((it) => it.id)).toEqual(['m3', 'm1']);
  });

  it('filters by source=automation (any non-null automationItemId)', async () => {
    prisma = makePrismaMock({
      accounts: [{ id: 'acc-1', type: 'demo' }],
      trades: [
        { id: 'a1', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'buy', price: 1, qty: 1, fee: null, timestamp: new Date(1), automationItemId: null },
        { id: 'a2', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'buy', price: 1, qty: 1, fee: null, timestamp: new Date(2), automationItemId: 'item-1' },
        { id: 'a3', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'buy', price: 1, qty: 1, fee: null, timestamp: new Date(3), automationItemId: 'item-9' },
      ],
    });
    service = new TradesService(
      prisma as unknown as ConstructorParameters<typeof TradesService>[0],
      orders,
    );
    const page = await service.listPage({ accountId: 'acc-1', source: 'automation' }, null, 50);
    expect(page.items.map((it) => it.id)).toEqual(['a3', 'a2']);
  });

  it('filters by source=<itemId> (only that item)', async () => {
    prisma = makePrismaMock({
      accounts: [{ id: 'acc-1', type: 'demo' }],
      trades: [
        { id: 'x1', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'buy', price: 1, qty: 1, fee: null, timestamp: new Date(1), automationItemId: 'item-1' },
        { id: 'x2', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'buy', price: 1, qty: 1, fee: null, timestamp: new Date(2), automationItemId: 'item-9' },
      ],
    });
    service = new TradesService(
      prisma as unknown as ConstructorParameters<typeof TradesService>[0],
      orders,
    );
    const page = await service.listPage({ accountId: 'acc-1', source: 'item-1' }, null, 50);
    expect(page.items.map((it) => it.id)).toEqual(['x1']);
  });

  it('filters by date range with from/to as ISO datetimes', async () => {
    prisma = makePrismaMock({
      accounts: [{ id: 'acc-1', type: 'demo' }],
      trades: [
        { id: 'd1', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'buy', price: 1, qty: 1, fee: null, timestamp: new Date('2026-01-01T00:00:00Z'), automationItemId: null },
        { id: 'd2', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'buy', price: 1, qty: 1, fee: null, timestamp: new Date('2026-02-01T00:00:00Z'), automationItemId: null },
        { id: 'd3', accountId: 'acc-1', symbol: 'BTCUSDT', side: 'buy', price: 1, qty: 1, fee: null, timestamp: new Date('2026-03-01T00:00:00Z'), automationItemId: null },
      ],
    });
    service = new TradesService(
      prisma as unknown as ConstructorParameters<typeof TradesService>[0],
      orders,
    );
    const page = await service.listPage(
      { accountId: 'acc-1', from: '2026-01-15T00:00:00.000Z', to: '2026-03-01T00:00:00.000Z' },
      null,
      50,
    );
    // Inclusive `from`, exclusive `to`: just d2.
    expect(page.items.map((it) => it.id)).toEqual(['d2']);
  });
});
