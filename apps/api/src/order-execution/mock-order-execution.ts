import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
// (BadRequestException is used by cancelOrder when state-machine
// validation fails; NotFoundException by getOrderStatus / cancelOrder
// for unknown ids.)
import type { Order, OrderEvent, PlaceOrderInput } from '@workspace/shared';
import {
  AccountType,
  OrderStatus,
  TradeSide,
} from '@workspace/shared';
import {
  ORDER_EXECUTION,
  type OrderExecution,
} from './order-execution.types.js';

/**
 * Mock implementation of `OrderExecution` for demo accounts. Fills
 * instantly at the configured mark price (NCN-13's `time`-triggered
 * rules depend on this determinism) but also exposes `placePendingOrder`
 * for tests that need to exercise cancel / reject paths.
 *
 * Threading `automationItemId` through to the emitted Order is what
 * lets TradeHistoryService attribute each fill back to its rule in the
 * Trade ledger (NCN-19).
 */
@Injectable()
export class MockOrderExecution implements OrderExecution {
  /** Marker for the future router (NCN-10) — this executor handles demo accounts. */
  readonly accountType = AccountType.DEMO;

  // Per-account order book (used for cancel / getOrderStatus lookups).
  private readonly orders = new Map<string, Map<string, Order>>();

  // Per-symbol mark price for the mock. Real impl queries the broker.
  // Empty by default — tests set explicit prices via `setFillPrice()`.
  private readonly fillPrices = new Map<string, number>();

  // Per-account listeners — DemoBalanceTracker, TradeHistoryService,
  // and any future consumer subscribe by accountId.
  private readonly subscribers = new Map<string, Set<(event: OrderEvent) => void>>();

  /** Set a deterministic fill price for tests / fixtures. */
  setFillPrice(symbol: string, price: number): void {
    this.fillPrices.set(symbol, price);
  }

  /** How many listeners are attached for `accountId`. Used by tests. */
  subscriberCount(accountId: string): number {
    return this.subscribers.get(accountId)?.size ?? 0;
  }

  /** Test helper — does this executor know about the given order id? */
  hasOrder(orderId: string): boolean {
    for (const bucket of this.orders.values()) {
      if (bucket.has(orderId)) return true;
    }
    return false;
  }

  /**
   * Place an order and instant-fill it (placed → filled back-to-back).
   * Returns a rejected order (rather than throwing) for invalid input
   * — the runner / manual endpoint can branch on status without
   * try/catch noise. The runner still counts this as an error per
   * item.
   */
  async placeOrder(input: PlaceOrderInput): Promise<Order> {
    const normalized = this.normalize(input);
    const validationError = this.validate(normalized);
    const now = new Date();
    const base: Order = {
      id: crypto.randomUUID(),
      accountId: normalized.accountId,
      symbol: normalized.symbol,
      side: normalized.side,
      qty: normalized.qty,
      status: OrderStatus.PENDING,
      fee: normalized.fee,
      automationItemId: normalized.automationItemId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    if (validationError !== null) {
      const rejected: Order = {
        ...base,
        status: OrderStatus.REJECTED,
        rejectionReason: validationError,
      };
      this.saveOrder(rejected);
      this.emit(normalized.accountId, { kind: 'rejected', order: rejected });
      return rejected;
    }
    this.saveOrder(base);
    this.emit(normalized.accountId, { kind: 'placed', order: base });
    return this.fillOrder(base);
  }

  /**
   * Place an order that stays PENDING (no fill event). Tests use this to
   * exercise cancel/reject paths. Real broker impls hit this branch
   * while waiting for fill confirmation.
   */
  async placePendingOrder(input: PlaceOrderInput): Promise<Order> {
    const normalized = this.normalize(input);
    const validationError = this.validate(normalized);
    const now = new Date();
    const base: Order = {
      id: crypto.randomUUID(),
      accountId: normalized.accountId,
      symbol: normalized.symbol,
      side: normalized.side,
      qty: normalized.qty,
      status: OrderStatus.PENDING,
      automationItemId: normalized.automationItemId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    if (validationError !== null) {
      const rejected: Order = {
        ...base,
        status: OrderStatus.REJECTED,
        rejectionReason: validationError,
      };
      this.saveOrder(rejected);
      this.emit(normalized.accountId, { kind: 'rejected', order: rejected });
      return rejected;
    }
    this.saveOrder(base);
    this.emit(normalized.accountId, { kind: 'placed', order: base });
    return base;
  }

  /**
   * Cancel a pending order. Throws NotFound if the orderId is unknown
   * for the given accountId, BadRequest if the order is in a terminal
   * state (filled/cancelled/rejected).
   */
  async cancelOrder(accountId: string, orderId: string): Promise<Order> {
    const order = this.requireOrder(accountId, orderId);
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException(
        `Cannot cancel order ${orderId} in status ${order.status}`,
      );
    }
    const cancelled: Order = {
      ...order,
      status: OrderStatus.CANCELLED,
      updatedAt: new Date().toISOString(),
    };
    this.saveOrder(cancelled);
    this.emit(accountId, { kind: 'cancelled', order: cancelled });
    return cancelled;
  }

  async getOrderStatus(accountId: string, orderId: string): Promise<Order> {
    return this.requireOrder(accountId, orderId);
  }

  /**
   * Subscribe to order events for an account. The returned unsubscribe
   * function is idempotent. Used by DemoBalanceTracker, TradeHistoryService,
   * and any consumer that needs the lifecycle event stream.
   */
  subscribe(
    filter: { accountId: string },
    handler: (event: OrderEvent) => void,
  ): () => void {
    let set = this.subscribers.get(filter.accountId);
    if (set === undefined) {
      set = new Set();
      this.subscribers.set(filter.accountId, set);
    }
    set.add(handler);
    return () => {
      const live = this.subscribers.get(filter.accountId);
      if (live === undefined) return;
      live.delete(handler);
      if (live.size === 0) this.subscribers.delete(filter.accountId);
    };
  }

  /**
   * Test-only reset. Wipes all orders, fill prices, and subscribers.
   * Not part of the OrderExecution interface — used between specs.
   */
  reset(): void {
    this.orders.clear();
    this.fillPrices.clear();
    this.subscribers.clear();
  }

  // ---------- internals ----------

  private normalize(input: PlaceOrderInput): PlaceOrderInput {
    const symbol = input.symbol.trim().toUpperCase();
    return { ...input, symbol };
  }

  private validate(input: PlaceOrderInput): string | null {
    if (!Number.isFinite(input.qty) || input.qty <= 0) {
      return `Order qty must be positive (received ${String(input.qty)})`;
    }
    return null;
  }

  private fillOrder(order: Order): Order {
    const fillPrice = this.fillPrices.get(order.symbol) ?? 1;
    // Reuse `createdAt` so callers can correlate placed → filled by
    // matching timestamps (the spec relies on this).
    const filled: Order = {
      ...order,
      status: OrderStatus.FILLED,
      filledPrice: fillPrice,
      filledAt: order.createdAt,
      updatedAt: order.createdAt,
    };
    this.saveOrder(filled);
    this.emit(filled.accountId, { kind: 'filled', order: filled });
    return filled;
  }

  private saveOrder(order: Order): void {
    let bucket = this.orders.get(order.accountId);
    if (bucket === undefined) {
      bucket = new Map();
      this.orders.set(order.accountId, bucket);
    }
    bucket.set(order.id, order);
  }

  private requireOrder(accountId: string, orderId: string): Order {
    const order = this.orders.get(accountId)?.get(orderId);
    if (order === undefined) {
      throw new NotFoundException(`Order ${orderId} not found for account ${accountId}`);
    }
    return order;
  }

  private emit(accountId: string, event: OrderEvent): void {
    const set = this.subscribers.get(accountId);
    if (set === undefined) return;
    for (const handler of set) {
      try {
        handler(event);
      } catch {
        // Don't let one bad subscriber take down the rest.
      }
    }
  }
}

// Re-export the DI token so consumers don't need to import from
// `order-execution.types.ts` separately.
export { ORDER_EXECUTION };
export { TradeSide };
