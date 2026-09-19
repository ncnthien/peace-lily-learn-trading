import { Inject, Injectable } from '@nestjs/common';
import type {
  AutomationAction,
  Order,
  PlaceOrderInput,
} from '@workspace/shared';
import { TradeSide } from '@workspace/shared';
import {
  ORDER_EXECUTION,
  type OrderExecution,
} from '../order-execution/order-execution.types.js';

/**
 * Context passed alongside an AutomationAction when the runner asks
 * the executor to translate + dispatch it.
 */
export interface ActionExecutionContext {
  accountId: string;
  /** Threaded through to the resulting Order so Trade ledger can attribute the fill. */
  automationItemId: string;
}

/**
 * Outcome of an ActionExecutor.execute() call. The runner branches on
 * the discriminator instead of catching exceptions, so success / no-op
 * / error paths are all explicit.
 */
export type ActionExecutionResult =
  | { kind: 'placed'; order: Order }
  | { kind: 'no-order'; reason: string };

/**
 * ActionExecutor (NCN-16).
 *
 * Bridges AutomationAction (the persisted config shape) to the Order
 * abstraction: `buy` / `sell` translate to a single OrderExecution
 * .placeOrder call; `notify` / `none` produce no order (logged as
 * skipped). The executor's contract is intentionally narrow — input
 * validation lives in the runner, retry / backoff / slippage controls
 * are a future iteration.
 *
 * Extracted from AutomationRunner so NCN-16's deliverable has a focused
 * unit-test surface and so future action kinds (stop-loss,
 * take-profit, …) plug in here without touching the runner loop.
 *
 * `execute()` resolves with `{ kind, … }` for the expected paths and
 * throws for unexpected errors (order-execution rejections, etc.) so
 * the runner can count them per-item without breaking the loop.
 */
@Injectable()
export class ActionExecutor {
  constructor(
    @Inject(ORDER_EXECUTION)
    private readonly orderExecution: OrderExecution,
  ) {}

  /**
   * Translate the action into a PlaceOrderInput and dispatch it. Returns
   * `{ kind: 'no-order', reason }` when the action doesn't map to a
   * trade (today: `notify`, `none`, or any future kind without a
   * dedicated handler) — the caller decides whether to skip silently
   * or warn.
   */
  async execute(
    action: AutomationAction,
    ctx: ActionExecutionContext,
  ): Promise<ActionExecutionResult> {
    const input = toPlaceOrderInput(action, ctx);
    if (input === null) {
      return {
        kind: 'no-order',
        reason: `action kind "${action.kind}" does not produce an order`,
      };
    }
    const order = await this.orderExecution.placeOrder(input);
    return { kind: 'placed', order };
  }
}

/**
 * Map AutomationAction → PlaceOrderInput. Pure function — exported so
 * the runner / tests / future automation flavors can reuse it without
 * spinning up the executor.
 *
 * Returns `null` when the action kind has no order-side mapping.
 */
export function toPlaceOrderInput(
  action: AutomationAction,
  ctx: ActionExecutionContext,
): PlaceOrderInput | null {
  if (action.kind === 'buy') {
    return {
      accountId: ctx.accountId,
      symbol: action.symbol,
      side: TradeSide.BUY,
      qty: action.qty,
      automationItemId: ctx.automationItemId,
    };
  }
  if (action.kind === 'sell') {
    return {
      accountId: ctx.accountId,
      symbol: action.symbol,
      side: TradeSide.SELL,
      qty: action.qty,
      automationItemId: ctx.automationItemId,
    };
  }
  return null;
}