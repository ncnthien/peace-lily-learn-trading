import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Order, OrderEvent, PlaceOrderInput, Unsubscribe } from '@workspace/shared';
import { AccountType, OrderStatus } from '@workspace/shared';
import type { OrderExecution } from './order-execution.types.js';

/** Normalize a symbol to the form the broker/exchange expects. */
function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

/**
 * Demo OrderExecution — in-memory store, instant fill at a configured price.
 * Owns its own order state (in future, this will move to a Prisma table).
 *
 * This is the DEMO side of the OrderExecution router pattern. The REAL
 * side (broker API — NCN-10) will follow the same interface but query the
 * platform's API for order status rather than maintaining local state.
 *
 * Fill prices default to 1.0; override per symbol via setFillPrice for
 * tests or seeded demo accounts.
 *
 * Event emission:
 *   - placeOrder (instant fill): emits 'placed' then 'filled' back-to-back
 *     so subscribers see the same lifecycle they would from a real broker.
 *   - placePendingOrder: emits 'placed' only (consumer or real broker will
 *     later emit 'filled' or 'cancelled').
 *   - cancelOrder on a pending order: emits 'cancelled'.
 *   - placeOrder with qty <= 0: emits 'rejected' (no 'placed' — the order
 *     never reached the broker).
 *   - All emissions are scoped to the order's accountId — subscribers on
 *     other accounts don't see them.
 */
@Injectable()
export class MockOrderExecution implements OrderExecution {
  readonly accountType: AccountType = AccountType.DEMO;

  private readonly logger = new Logger(MockOrderExecution.name);
  private readonly orders = new Map<string, Order>();
  private readonly fillPrices = new Map<string, number>();
  private readonly eventSubscribers = new Map<string, Set<(event: OrderEvent) => void>>();
  private readonly DEFAULT_FILL_PRICE = 1;

  /** Configure the fill price for a symbol (testing/seed helper). */
  setFillPrice(symbol: string, price: number): void {
    this.fillPrices.set(normalizeSymbol(symbol), price);
  }

  /** Wipe all orders, per-symbol fill prices, and event subscribers. Test cleanup helper. */
  reset(): void {
    this.orders.clear();
    this.fillPrices.clear();
    this.eventSubscribers.clear();
  }

  async placeOrder(input: PlaceOrderInput): Promise<Order> {
    const symbol = normalizeSymbol(input.symbol);
    const now = new Date().toISOString();
    const id = randomUUID();
    const base = {
      id,
      accountId: input.accountId,
      symbol,
      side: input.side,
      qty: input.qty,
      createdAt: now,
      updatedAt: now,
    } satisfies Omit<Order, 'status'>;

    if (input.qty <= 0) {
      const order: Order = {
        ...base,
        status: OrderStatus.REJECTED,
        rejectionReason: 'qty must be > 0',
      };
      this.orders.set(id, order);
      this.emit(order.accountId, { kind: 'rejected', order });
      return order;
    }

    // Emit 'placed' first so subscribers observe the same lifecycle they'd
    // see from a real broker (placed → filled). The pending view does not
    // carry a filledPrice — that's only known once the broker confirms.
    const placed: Order = { ...base, status: OrderStatus.PENDING };
    this.emit(placed.accountId, { kind: 'placed', order: placed });

    const price = this.fillPrices.get(symbol) ?? this.DEFAULT_FILL_PRICE;
    const filled: Order = {
      ...base,
      status: OrderStatus.FILLED,
      filledPrice: price,
      filledAt: now,
    };
    this.orders.set(id, filled);
    this.emit(filled.accountId, { kind: 'filled', order: filled });
    return filled;
  }

  /**
   * Mock-only helper for tests: place an order that stays PENDING so the
   * cancelOrder path can be exercised. Real broker impls don't need this —
   * PENDING is their natural pre-fill state.
   */
  async placePendingOrder(input: PlaceOrderInput): Promise<Order> {
    const order: Order = {
      id: randomUUID(),
      accountId: input.accountId,
      symbol: normalizeSymbol(input.symbol),
      side: input.side,
      qty: input.qty,
      status: OrderStatus.PENDING,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.orders.set(order.id, order);
    this.emit(order.accountId, { kind: 'placed', order });
    return order;
  }

  async cancelOrder(accountId: string, orderId: string): Promise<Order> {
    const order = this.orders.get(orderId);
    if (order === undefined || order.accountId !== accountId) {
      throw new NotFoundException(`Order ${orderId} not found for account ${accountId}`);
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException(
        `Order ${orderId} is ${order.status} and cannot be cancelled`,
      );
    }
    order.status = OrderStatus.CANCELLED;
    order.updatedAt = new Date().toISOString();
    this.emit(order.accountId, { kind: 'cancelled', order });
    return order;
  }

  async getOrderStatus(accountId: string, orderId: string): Promise<Order> {
    const order = this.orders.get(orderId);
    if (order === undefined || order.accountId !== accountId) {
      throw new NotFoundException(`Order ${orderId} not found for account ${accountId}`);
    }
    return order;
  }

  subscribe(
    input: { accountId: string },
    onEvent: (event: OrderEvent) => void,
  ): Unsubscribe {
    const accountId = input.accountId;
    let subs = this.eventSubscribers.get(accountId);
    if (subs === undefined) {
      subs = new Set();
      this.eventSubscribers.set(accountId, subs);
    }
    subs.add(onEvent);
    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      const current = this.eventSubscribers.get(accountId);
      if (current === undefined) return;
      current.delete(onEvent);
      if (current.size === 0) this.eventSubscribers.delete(accountId);
    };
  }

  /** Test-only introspection */
  hasOrder(orderId: string): boolean {
    return this.orders.has(orderId);
  }

  /** Test-only introspection */
  subscriberCount(accountId: string): number {
    return this.eventSubscribers.get(accountId)?.size ?? 0;
  }

  private emit(accountId: string, event: OrderEvent): void {
    const subs = this.eventSubscribers.get(accountId);
    if (subs === undefined) return;
    for (const cb of subs) {
      try {
        cb(event);
      } catch (err) {
        this.logger.error(
          `Order event subscriber for ${accountId} threw: ${String(err)}`,
        );
      }
    }
  }
}
