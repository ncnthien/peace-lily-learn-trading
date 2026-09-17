import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import type { OrderEvent } from '@workspace/shared';
import { AccountType, OrderStatus, TradeSide } from '@workspace/shared';
import { MockOrderExecution } from './mock-order-execution.js';

const ACCOUNT = 'acc-1';
const OTHER_ACCOUNT = 'acc-2';

function buyInput(overrides: Partial<{ symbol: string; qty: number; accountId: string }> = {}) {
  return {
    accountId: ACCOUNT,
    symbol: 'BTCUSDT',
    side: TradeSide.BUY,
    qty: 1,
    ...overrides,
  };
}

function eventKinds(events: OrderEvent[]): string[] {
  return events.map((e) => e.kind);
}

describe('MockOrderExecution', () => {
  let exec: MockOrderExecution;

  beforeEach(() => {
    exec = new MockOrderExecution();
  });

  it('declares itself the DEMO accountType (router uses this to dispatch)', () => {
    expect(exec.accountType).toBe(AccountType.DEMO);
  });

  describe('placeOrder', () => {
    it('fills a valid order instantly at the configured price', async () => {
      exec.setFillPrice('BTCUSDT', 50_000);
      const order = await exec.placeOrder(buyInput({ qty: 0.5 }));
      expect(order.status).toBe(OrderStatus.FILLED);
      expect(order.filledPrice).toBe(50_000);
      expect(order.filledAt).toBe(order.createdAt);
      expect(order.symbol).toBe('BTCUSDT');
      expect(order.accountId).toBe(ACCOUNT);
      expect(order.qty).toBe(0.5);
      expect(order.side).toBe(TradeSide.BUY);
    });

    it('normalizes the symbol (trim + uppercase)', async () => {
      const order = await exec.placeOrder(buyInput({ symbol: '  btcusdt  ' }));
      expect(order.symbol).toBe('BTCUSDT');
    });

    it('defaults the fill price to 1 when none configured', async () => {
      const order = await exec.placeOrder(buyInput());
      expect(order.filledPrice).toBe(1);
    });

    it('rejects orders with qty <= 0', async () => {
      const order = await exec.placeOrder(buyInput({ qty: 0 }));
      expect(order.status).toBe(OrderStatus.REJECTED);
      expect(order.rejectionReason).toMatch(/qty/i);
      expect(order.filledPrice).toBeUndefined();
    });

    it('rejects orders with negative qty', async () => {
      const order = await exec.placeOrder(buyInput({ qty: -1 }));
      expect(order.status).toBe(OrderStatus.REJECTED);
    });

    it('uses the most recently configured price for the normalized symbol', async () => {
      exec.setFillPrice('btcusdt', 100);
      exec.setFillPrice('BTCUSDT', 200);
      const order = await exec.placeOrder(buyInput());
      expect(order.filledPrice).toBe(200);
    });
  });

  describe('cancelOrder', () => {
    it('cancels a pending order', async () => {
      const pending = await exec.placePendingOrder(buyInput());
      const cancelled = await exec.cancelOrder(pending.accountId, pending.id);
      expect(cancelled.status).toBe(OrderStatus.CANCELLED);
      expect(cancelled.updatedAt >= pending.updatedAt).toBe(true);
    });

    it('throws BadRequest when cancelling a filled order', async () => {
      const order = await exec.placeOrder(buyInput());
      await expect(
        exec.cancelOrder(order.accountId, order.id),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws BadRequest when cancelling an already-cancelled order', async () => {
      const pending = await exec.placePendingOrder(buyInput());
      await exec.cancelOrder(pending.accountId, pending.id);
      await expect(
        exec.cancelOrder(pending.accountId, pending.id),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFound for unknown ids', async () => {
      await expect(
        exec.cancelOrder(ACCOUNT, 'does-not-exist'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFound when the order belongs to a different account', async () => {
      const order = await exec.placePendingOrder(buyInput());
      await expect(
        exec.cancelOrder(OTHER_ACCOUNT, order.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getOrderStatus', () => {
    it('returns the order by id when accountId matches', async () => {
      const placed = await exec.placeOrder(buyInput());
      const fetched = await exec.getOrderStatus(placed.accountId, placed.id);
      expect(fetched).toEqual(placed);
    });

    it('throws NotFound for unknown ids', async () => {
      await expect(
        exec.getOrderStatus(ACCOUNT, 'does-not-exist'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFound when the order belongs to a different account', async () => {
      const placed = await exec.placeOrder(buyInput({ accountId: ACCOUNT }));
      await expect(
        exec.getOrderStatus(OTHER_ACCOUNT, placed.id),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('subscribe (events)', () => {
    it('emits placed then filled for an instant-fill placeOrder', async () => {
      const events: OrderEvent[] = [];
      exec.subscribe({ accountId: ACCOUNT }, (e) => events.push(e));
      await exec.placeOrder(buyInput());
      expect(eventKinds(events)).toEqual(['placed', 'filled']);
      const filled = events[1]!;
      expect(filled.kind).toBe('filled');
      if (filled.kind === 'filled') {
        expect(filled.order.status).toBe(OrderStatus.FILLED);
        expect(filled.order.filledPrice).toBe(1);
      }
    });

    it('emits only placed for placePendingOrder', async () => {
      const events: OrderEvent[] = [];
      exec.subscribe({ accountId: ACCOUNT }, (e) => events.push(e));
      await exec.placePendingOrder(buyInput());
      expect(eventKinds(events)).toEqual(['placed']);
    });

    it('emits cancelled when cancelling a pending order', async () => {
      const events: OrderEvent[] = [];
      exec.subscribe({ accountId: ACCOUNT }, (e) => events.push(e));
      const pending = await exec.placePendingOrder(buyInput()); // emits 'placed'
      events.length = 0; // focus on the cancel event
      await exec.cancelOrder(pending.accountId, pending.id);
      expect(eventKinds(events)).toEqual(['cancelled']);
    });

    it('emits rejected (no placed) for invalid qty', async () => {
      const events: OrderEvent[] = [];
      exec.subscribe({ accountId: ACCOUNT }, (e) => events.push(e));
      await exec.placeOrder(buyInput({ qty: 0 }));
      expect(eventKinds(events)).toEqual(['rejected']);
    });

    it('does not emit to subscribers of other accounts', async () => {
      const eventsA: OrderEvent[] = [];
      const eventsB: OrderEvent[] = [];
      exec.subscribe({ accountId: ACCOUNT }, (e) => eventsA.push(e));
      exec.subscribe({ accountId: OTHER_ACCOUNT }, (e) => eventsB.push(e));
      await exec.placeOrder(buyInput({ accountId: ACCOUNT }));
      expect(eventsA.length).toBeGreaterThan(0);
      expect(eventsB.length).toBe(0);
    });

    it('fans out to multiple subscribers of the same account', async () => {
      const a: OrderEvent[] = [];
      const b: OrderEvent[] = [];
      exec.subscribe({ accountId: ACCOUNT }, (e) => a.push(e));
      exec.subscribe({ accountId: ACCOUNT }, (e) => b.push(e));
      await exec.placeOrder(buyInput());
      expect(a.length).toBe(2);
      expect(b.length).toBe(2);
    });

    it('stops emitting after unsubscribe', async () => {
      const events: OrderEvent[] = [];
      const unsub = exec.subscribe({ accountId: ACCOUNT }, (e) => events.push(e));
      await exec.placeOrder(buyInput());
      expect(events.length).toBeGreaterThan(0);
      const before = events.length;
      unsub();
      await exec.placeOrder(buyInput());
      expect(events.length).toBe(before); // no new events
    });

    it('unsubscribe is idempotent', () => {
      const unsub = exec.subscribe({ accountId: ACCOUNT }, () => {});
      unsub();
      expect(() => unsub()).not.toThrow();
    });
  });

  describe('reset', () => {
    it('clears orders, fill prices, and event subscribers', async () => {
      exec.setFillPrice('BTCUSDT', 100);
      const order = await exec.placeOrder(buyInput());
      expect(exec.hasOrder(order.id)).toBe(true);
      expect(exec.subscriberCount(ACCOUNT)).toBe(0);

      exec.subscribe({ accountId: ACCOUNT }, () => {});
      expect(exec.subscriberCount(ACCOUNT)).toBe(1);

      exec.reset();

      expect(exec.hasOrder(order.id)).toBe(false);
      expect(exec.subscriberCount(ACCOUNT)).toBe(0);
      // After reset, fill price falls back to default
      const next = await exec.placeOrder(buyInput());
      expect(next.filledPrice).toBe(1);
    });
  });
});
