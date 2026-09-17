import type { OrderEvent, Unsubscribe } from '@workspace/shared';
import { OrderStatus, TradeSide } from '@workspace/shared';
import { DemoBalanceTracker } from './demo-balance.tracker.js';
import type { OrderExecution } from '../order-execution/order-execution.types.js';

function makeExecMock() {
  const handlers = new Map<string, (event: OrderEvent) => void>();
  const unsubscribers: Unsubscribe[] = [];
  const subscribe = vi.fn((input: { accountId: string }, onEvent: (event: OrderEvent) => void) => {
    handlers.set(input.accountId, onEvent);
    const unsub: Unsubscribe = vi.fn(() => {
      handlers.delete(input.accountId);
    });
    unsubscribers.push(unsub);
    return unsub;
  });
  return { handlers, unsubscribers, subscribe };
}

function makePrismaMock() {
  return {
    account: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  };
}

function makeOrder(overrides: Partial<OrderEvent['order']> = {}): OrderEvent['order'] {
  return {
    id: overrides.id ?? 'ord-1',
    accountId: overrides.accountId ?? 'acc-1',
    symbol: overrides.symbol ?? 'BTCUSDT',
    side: overrides.side ?? TradeSide.BUY,
    qty: overrides.qty ?? 0.1,
    status: overrides.status ?? OrderStatus.FILLED,
    filledPrice: overrides.filledPrice ?? 50_000,
    filledAt: overrides.filledAt ?? new Date('2026-01-01').toISOString(),
    createdAt: overrides.createdAt ?? new Date('2026-01-01').toISOString(),
    updatedAt: overrides.updatedAt ?? new Date('2026-01-01').toISOString(),
  };
}

describe('DemoBalanceTracker', () => {
  let exec: ReturnType<typeof makeExecMock>;
  let prisma: ReturnType<typeof makePrismaMock>;
  let tracker: DemoBalanceTracker;

  beforeEach(() => {
    exec = makeExecMock();
    prisma = makePrismaMock();
    tracker = new DemoBalanceTracker(
      { subscribe: exec.subscribe } as unknown as OrderExecution,
      prisma as unknown as ConstructorParameters<typeof DemoBalanceTracker>[1],
    );
  });

  describe('bootstrap (onModuleInit)', () => {
    it('subscribes to every demo account that exists on startup', async () => {
      prisma.account.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
      await tracker.onModuleInit();
      expect(prisma.account.findMany).toHaveBeenCalledWith({
        where: { type: 'demo' },
        select: { id: true },
      });
      expect(exec.subscribe).toHaveBeenCalledTimes(2);
      expect(exec.subscribe).toHaveBeenNthCalledWith(1, { accountId: 'a' }, expect.any(Function));
      expect(exec.subscribe).toHaveBeenNthCalledWith(2, { accountId: 'b' }, expect.any(Function));
    });

    it('does nothing when there are no demo accounts', async () => {
      prisma.account.findMany.mockResolvedValue([]);
      await tracker.onModuleInit();
      expect(exec.subscribe).not.toHaveBeenCalled();
    });
  });

  describe('track / untrack', () => {
    it('track is idempotent (calling twice keeps one subscription)', async () => {
      tracker.track('acc-1');
      tracker.track('acc-1');
      expect(exec.subscribe).toHaveBeenCalledTimes(1);
    });

    it('untrack detaches the subscription; safe to call twice', () => {
      tracker.track('acc-1');
      tracker.untrack('acc-1');
      tracker.untrack('acc-1'); // no throw
      expect(exec.unsubscribers[0]).toHaveBeenCalledTimes(1);
    });
  });

  describe('fill handling', () => {
    it('deducts price*qty on a BUY fill', async () => {
      tracker.track('acc-1');
      prisma.account.update.mockResolvedValue({});
      const handler = exec.handlers.get('acc-1');
      if (handler === undefined) throw new Error('handler not registered');

      await handler({ kind: 'filled', order: makeOrder({ side: TradeSide.BUY, qty: 0.1, filledPrice: 50_000 }) });
      expect(prisma.account.update).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
        data: { balance: { increment: -5_000 } },
      });
    });

    it('credits price*qty on a SELL fill', async () => {
      tracker.track('acc-1');
      prisma.account.update.mockResolvedValue({});
      const handler = exec.handlers.get('acc-1');
      if (handler === undefined) throw new Error('handler not registered');

      await handler({ kind: 'filled', order: makeOrder({ side: TradeSide.SELL, qty: 0.5, filledPrice: 60_000 }) });
      expect(prisma.account.update).toHaveBeenCalledWith({
        where: { id: 'acc-1' },
        data: { balance: { increment: 30_000 } },
      });
    });

    it('ignores placed/cancelled/rejected events', async () => {
      tracker.track('acc-1');
      const handler = exec.handlers.get('acc-1');
      if (handler === undefined) throw new Error('handler not registered');

      await handler({ kind: 'placed', order: makeOrder() });
      await handler({ kind: 'cancelled', order: makeOrder() });
      await handler({ kind: 'rejected', order: makeOrder() });
      expect(prisma.account.update).not.toHaveBeenCalled();
    });

    it('ignores fills for a different accountId', async () => {
      tracker.track('acc-1');
      const handler = exec.handlers.get('acc-1');
      if (handler === undefined) throw new Error('handler not registered');

      await handler({ kind: 'filled', order: makeOrder({ accountId: 'acc-other' }) });
      expect(prisma.account.update).not.toHaveBeenCalled();
    });

    it('ignores fills with no filledPrice (defensive)', async () => {
      tracker.track('acc-1');
      const handler = exec.handlers.get('acc-1');
      if (handler === undefined) throw new Error('handler not registered');

      // Build the order inline so filledPrice stays absent (the helper would
      // default-fill an undefined to 50_000).
      const orderWithoutFillPrice = {
        id: 'ord-1',
        accountId: 'acc-1',
        symbol: 'BTCUSDT',
        side: TradeSide.BUY,
        qty: 0.1,
        status: OrderStatus.FILLED,
        createdAt: new Date('2026-01-01').toISOString(),
        updatedAt: new Date('2026-01-01').toISOString(),
      };
      await handler({ kind: 'filled', order: orderWithoutFillPrice });
      expect(prisma.account.update).not.toHaveBeenCalled();
    });

    it('untracks when the DB update fails (e.g. account deleted between event and update)', async () => {
      tracker.track('acc-1');
      prisma.account.update.mockRejectedValue(new Error('record not found'));
      const handler = exec.handlers.get('acc-1');
      if (handler === undefined) throw new Error('handler not registered');

      await handler({ kind: 'filled', order: makeOrder() });
      expect(exec.unsubscribers[0]).toHaveBeenCalled();
    });
  });

  describe('onModuleDestroy', () => {
    it('detaches every active subscription', () => {
      tracker.track('a');
      tracker.track('b');
      tracker.onModuleDestroy();
      expect(exec.unsubscribers).toHaveLength(2);
      expect(exec.unsubscribers[0]).toHaveBeenCalled();
      expect(exec.unsubscribers[1]).toHaveBeenCalled();
    });
  });
});
