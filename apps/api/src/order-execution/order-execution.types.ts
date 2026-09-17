import type {
  AccountType,
  Order,
  OrderEvent,
  PlaceOrderInput,
  Unsubscribe,
} from '@workspace/shared';

/**
 * Order execution abstraction — place orders independent of any specific
 * broker/exchange. Demo and real accounts have different storage strategies
 * (our DB vs the platform's API), so the interface is designed for a router
 * pattern:
 *
 *   ┌──────────────────────┐
 *   │  OrderExecutionRouter │  ← looks up account type, dispatches
 *   └──────┬────────┬───────┘
 *          │        │
 *   ┌──────▼──┐  ┌──▼──────────────┐
 *   │  Demo   │  │  Real (later)    │
 *   │ (in-mem │  │  (broker API —   │
 *   │  / DB)  │  │   NCN-10)        │
 *   └─────────┘  └─────────────────┘
 *
 * Callers always see the same interface. The router (added when Account
 * CRUD lands in NCN-8) picks the right impl based on `accountType`.
 *
 * All methods are async to match the network-bound nature of real brokers
 * even though the in-memory demo resolves synchronously.
 *
 * Method semantics:
 *   - placeOrder: may return status=FILLED (demo instant fill) or
 *     status=PENDING (real broker; will transition later). Callers must
 *     handle both.
 *   - cancelOrder: only succeeds on PENDING orders. Throws on terminal
 *     status or unknown id.
 *   - getOrderStatus: returns the current order. For real accounts this
 *     hits the broker API; for demo it reads local state.
 *   - subscribe: returns an Unsubscribe handle. Events are filtered by
 *     accountId — a subscriber only sees events for orders it owns.
 */
export abstract class OrderExecution {
  /** Which account type this executor handles. Used by the router. */
  abstract readonly accountType: AccountType;

  /** Place an order. Returns the order with its initial status. */
  abstract placeOrder(input: PlaceOrderInput): Promise<Order>;

  /**
   * Cancel a pending order. Returns the updated order on success.
   * Throws if the order is already in a terminal state (filled, cancelled,
   * rejected) or if the orderId is unknown for the given accountId.
   */
  abstract cancelOrder(accountId: string, orderId: string): Promise<Order>;

  /**
   * Get the current state of an order.
   * Throws if the orderId is unknown for the given accountId.
   */
  abstract getOrderStatus(accountId: string, orderId: string): Promise<Order>;

  /**
   * Subscribe to order lifecycle events for a given account.
   * Events fire on every state transition (placed, filled, cancelled,
   * rejected) and are scoped to the accountId in the input — callers
   * never see other accounts' events. Returns an Unsubscribe handle.
   */
  abstract subscribe(
    input: { accountId: string },
    onEvent: (event: OrderEvent) => void,
  ): Unsubscribe;
}

/** DI token — bind a concrete execution backend (or the router) here. */
export const ORDER_EXECUTION = Symbol('OrderExecution');
