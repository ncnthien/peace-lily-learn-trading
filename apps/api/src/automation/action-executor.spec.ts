import type { AutomationAction, OrderStatus, PlaceOrderInput, TradeSide } from '@workspace/shared';
import type { OrderExecution } from '../order-execution/order-execution.types.js';
import {
  ActionExecutor,
  toPlaceOrderInput,
  type ActionExecutionContext,
} from './action-executor.js';

/**
 * ActionExecutor tests (NCN-16).
 *
 * Coverage:
 *   - buy → buy order with the right fields
 *   - sell → sell order with the right fields
 *   - notify / none → `{ kind: 'no-order', reason }`
 *   - accountId, symbol, qty, automationItemId all threaded through
 *   - order-execution errors propagate so the runner can count them
 *   - pure `toPlaceOrderInput` is independently covered
 */

function mockOrderExecution(): {
  exec: OrderExecution;
  calls: PlaceOrderInput[];
} {
  const calls: PlaceOrderInput[] = [];
  const exec: OrderExecution = {
    accountType: 'demo',
    placeOrder: vi.fn(async (input: PlaceOrderInput) => {
      calls.push(input);
      return {
        id: `ord-${calls.length}`,
        accountId: input.accountId,
        symbol: input.symbol,
        side: input.side,
        qty: input.qty,
        status: 'filled' as OrderStatus,
        filledPrice: 100,
        filledAt: '2026-09-19T00:00:00.000Z',
        createdAt: '2026-09-19T00:00:00.000Z',
        updatedAt: '2026-09-19T00:00:00.000Z',
        automationItemId: input.automationItemId,
      };
    }),
    cancelOrder: vi.fn(async () => {
      throw new Error('not used in these tests');
    }),
    getOrderStatus: vi.fn(async () => {
      throw new Error('not used in these tests');
    }),
    subscribe: vi.fn(() => () => {}),
  };
  return { exec, calls };
}

const ctx: ActionExecutionContext = {
  accountId: 'acc-1',
  automationItemId: 'auto-1',
};

describe('ActionExecutor (NCN-16)', () => {
  it('places a buy order and threads every field', async () => {
    const { exec, calls } = mockOrderExecution();
    const executor = new ActionExecutor(exec);
    const result = await executor.execute(
      { kind: 'buy', symbol: 'BTCUSDT', qty: 0.01 },
      ctx,
    );
    expect(result.kind).toBe('placed');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      accountId: 'acc-1',
      symbol: 'BTCUSDT',
      side: 'buy' as TradeSide,
      qty: 0.01,
      automationItemId: 'auto-1',
    });
    if (result.kind === 'placed') {
      expect(result.order.symbol).toBe('BTCUSDT');
      expect(result.order.accountId).toBe('acc-1');
      expect(result.order.automationItemId).toBe('auto-1');
      expect(result.order.status).toBe('filled');
    }
  });

  it('places a sell order and tags automationItemId', async () => {
    const { exec, calls } = mockOrderExecution();
    const executor = new ActionExecutor(exec);
    const result = await executor.execute(
      { kind: 'sell', symbol: 'ETHUSDT', qty: 0.5 },
      ctx,
    );
    expect(result.kind).toBe('placed');
    expect(calls[0]!.side).toBe('sell');
    expect(calls[0]!.symbol).toBe('ETHUSDT');
    expect(calls[0]!.qty).toBe(0.5);
    expect(calls[0]!.automationItemId).toBe('auto-1');
  });

  it('threads a different accountId and automationItemId through', async () => {
    // Symbol case is preserved by the executor (it just maps config →
    // input). Normalization (uppercasing, trimming) lives in the
    // order-execution backend.
    const { exec, calls } = mockOrderExecution();
    const executor = new ActionExecutor(exec);
    await executor.execute(
      { kind: 'buy', symbol: 'btcusdt', qty: 0.001 },
      { accountId: 'acc-other', automationItemId: 'auto-42' },
    );
    expect(calls[0]!.symbol).toBe('btcusdt');
    expect(calls[0]!.accountId).toBe('acc-other');
    expect(calls[0]!.automationItemId).toBe('auto-42');
  });

  it('returns no-order for a notify action without calling placeOrder', async () => {
    const { exec, calls } = mockOrderExecution();
    const executor = new ActionExecutor(exec);
    const result = await executor.execute(
      { kind: 'notify', message: 'price alert' } as unknown as AutomationAction,
      ctx,
    );
    expect(result.kind).toBe('no-order');
    if (result.kind === 'no-order') {
      expect(result.reason).toMatch(/notify/);
    }
    expect(calls).toHaveLength(0);
  });

  it('returns no-order for an unknown action kind', async () => {
    const { exec, calls } = mockOrderExecution();
    const executor = new ActionExecutor(exec);
    const result = await executor.execute(
      { kind: 'unknown_kind' } as unknown as AutomationAction,
      ctx,
    );
    expect(result.kind).toBe('no-order');
    expect(calls).toHaveLength(0);
  });

  it('propagates order-execution errors so the runner can count them', async () => {
    const failing: OrderExecution = {
      accountType: 'demo',
      placeOrder: vi.fn(async () => {
        throw new Error('simulated order failure');
      }),
      cancelOrder: vi.fn(async () => {
        throw new Error('not used');
      }),
      getOrderStatus: vi.fn(async () => {
        throw new Error('not used');
      }),
      subscribe: vi.fn(() => () => {}),
    };
    const executor = new ActionExecutor(failing);
    await expect(
      executor.execute({ kind: 'buy', symbol: 'BTCUSDT', qty: 1 }, ctx),
    ).rejects.toThrow(/simulated order failure/);
  });
});

describe('toPlaceOrderInput (NCN-16)', () => {
  it('maps a buy action to a PlaceOrderInput with side=buy', () => {
    const out = toPlaceOrderInput(
      { kind: 'buy', symbol: 'BTCUSDT', qty: 0.1 },
      ctx,
    );
    expect(out).toEqual({
      accountId: 'acc-1',
      symbol: 'BTCUSDT',
      side: 'buy',
      qty: 0.1,
      automationItemId: 'auto-1',
    });
  });

  it('maps a sell action to a PlaceOrderInput with side=sell', () => {
    const out = toPlaceOrderInput(
      { kind: 'sell', symbol: 'ETHUSDT', qty: 2 },
      ctx,
    );
    expect(out).toMatchObject({
      accountId: 'acc-1',
      symbol: 'ETHUSDT',
      side: 'sell',
      qty: 2,
      automationItemId: 'auto-1',
    });
  });

  it('returns null for notify / none / unsupported kinds', () => {
    expect(
      toPlaceOrderInput(
        { kind: 'notify', message: 'x' } as unknown as AutomationAction,
        ctx,
      ),
    ).toBeNull();
    expect(
      toPlaceOrderInput({ kind: 'none' } as unknown as AutomationAction, ctx),
    ).toBeNull();
    expect(
      toPlaceOrderInput(
        { kind: 'something_else' } as unknown as AutomationAction,
        ctx,
      ),
    ).toBeNull();
  });
});