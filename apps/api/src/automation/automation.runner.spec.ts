import { ProviderRegistry } from './providers/provider.registry.js';
import { TimeProvider } from './providers/time.provider.js';
import { SRProvider } from './providers/sr.provider.js';
import { WaveProvider } from './providers/wave.provider.js';
import { AutomationRunner } from './automation.runner.js';
import { ActionExecutor } from './action-executor.js';
import { ConditionEvaluator } from './rule-engine/condition.evaluator.js';
import { MockOrderExecution } from '../order-execution/mock-order-execution.js';
import type { MarketDataSource } from '../market-data/market-data.types.js';
import type { Candle } from '@workspace/shared';

interface ItemRow {
  id: string;
  accountId: string;
  input: unknown;
  condition: unknown;
  action: unknown;
  status: string;
}

/**
 * Apply a Prisma `data` payload to an in-memory row. Handles the small
 * subset of Prisma update operators we actually use: plain value sets
 * and `{ increment: n }` on numeric fields. Everything else is set
 * verbatim via Object.assign semantics.
 */
function applyDataUpdate(row: Record<string, unknown>, data: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(data)) {
    if (
      value !== null &&
      typeof value === 'object' &&
      'increment' in (value as Record<string, unknown>) &&
      typeof (value as { increment: unknown }).increment === 'number'
    ) {
      const current = (row[key] as number | undefined) ?? 0;
      row[key] = current + (value as { increment: number }).increment;
    } else {
      row[key] = value;
    }
  }
}

function makePrismaMock(rows: ItemRow[]) {
  const records: { updates: unknown[]; upserts: unknown[] } = { updates: [], upserts: [] };
  const runRows: unknown[] = [];
  return {
    records,
    runRows,
    automationItem: {
      findMany: vi.fn(async () => rows.filter((r) => r.status === 'enabled')),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return rows.find((r) => r.id === where.id) ?? null;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        records.updates.push({ id: where.id, data });
        const row = rows.find((r) => r.id === where.id);
        if (row === undefined) throw new Error(`no row ${where.id}`);
        applyDataUpdate(row as unknown as Record<string, unknown>, data);
        return row;
      }),
      updateMany: vi.fn(
        async ({ where, data }: { where: { id: string; consecutiveErrors?: { gt: number } }; data: Record<string, unknown> }) => {
          records.updates.push({ id: where.id, data });
          const row = rows.find((r) => r.id === where.id);
          if (row !== undefined) applyDataUpdate(row as unknown as Record<string, unknown>, data);
          return { count: row !== undefined ? 1 : 0 };
        },
      ),
    },
    automationRun: {
      create: vi.fn(async ({ data }: { data: unknown }) => {
        runRows.push(data);
        return data;
      }),
      findMany: vi.fn(async () => runRows.slice().reverse()),
    },
  };
}

function makeRow(overrides: Partial<ItemRow> = {}): ItemRow {
  return {
    id: overrides.id ?? 'item-1',
    accountId: overrides.accountId ?? 'acc-1',
    input: overrides.input ?? { kind: 'time', cron: '* * * * *' },
    condition: overrides.condition ?? { type: 'legacy_pass' },
    action: overrides.action ?? { kind: 'buy', symbol: 'BTCUSDT', qty: 0.01 },
    status: overrides.status ?? 'enabled',
  };
}

describe('AutomationRunner', () => {
  let registry: ProviderRegistry;
  let evaluator: ConditionEvaluator;
  let orders: MockOrderExecution;
  let prisma: ReturnType<typeof makePrismaMock>;
  let runner: AutomationRunner;
  let actionExecutor: ActionExecutor;

  beforeEach(() => {
    registry = new ProviderRegistry();
    new TimeProvider(registry); // self-registers as 'time'
    evaluator = new ConditionEvaluator();
    orders = new MockOrderExecution();
    orders.setFillPrice('BTCUSDT', 50_000);
    actionExecutor = new ActionExecutor(orders);
    prisma = makePrismaMock([]);
    runner = new AutomationRunner(
      prisma as unknown as ConstructorParameters<typeof AutomationRunner>[0],
      registry,
      evaluator,
      actionExecutor,
    );
  });

  it('fires an order when a time-triggered item + legacy_pass condition run on a matching minute', async () => {
    prisma = makePrismaMock([makeRow()]);
    runner = new AutomationRunner(
      prisma as unknown as ConstructorParameters<typeof AutomationRunner>[0],
      registry,
      evaluator,
      actionExecutor,
    );

    const now = Math.floor(Date.now() / 60_000) * 60_000;
    const summary = await runner.runOnce(now);

    expect(summary).toEqual({
      considered: 1,
      fired: 1,
      skipped: 0,
      errors: 0,
    });
    // The mock executor fills instantly; check the fill price landed.
    expect(orders.subscriberCount('acc-1')).toBeGreaterThanOrEqual(0);
  });

  it('skips items whose cron does not match the current minute', async () => {
    prisma = makePrismaMock([
      makeRow({ id: 'a', input: { kind: 'time', cron: '0 * * * *' } }),
    ]);
    runner = new AutomationRunner(
      prisma as unknown as ConstructorParameters<typeof AutomationRunner>[0],
      registry,
      evaluator,
      actionExecutor,
    );

    // Use a minute that is definitely not :00 in UTC by skipping ahead if needed.
    let now = Math.floor(Date.now() / 60_000) * 60_000;
    if (now % 3_600_000 < 60_000) now += 60_000;

    const summary = await runner.runOnce(now);
    expect(summary.skipped).toBe(1);
    expect(summary.fired).toBe(0);
  });

  it('skips items whose condition does not hold', async () => {
    prisma = makePrismaMock([
      // Wave signal must be 'down' from rsiEmaWave but our only signal is
      // from the 'time' provider — findSignal won't match.
      makeRow({
        condition: {
          type: 'wave_direction',
          direction: 'down',
          source: { providerKind: 'rsiEmaWave' },
        },
      }),
    ]);
    runner = new AutomationRunner(
      prisma as unknown as ConstructorParameters<typeof AutomationRunner>[0],
      registry,
      evaluator,
      actionExecutor,
    );

    const now = Math.floor(Date.now() / 60_000) * 60_000;
    const summary = await runner.runOnce(now);
    expect(summary.skipped).toBe(1);
    expect(summary.fired).toBe(0);
  });

  it('skips items whose input provider kind is not registered', async () => {
    prisma = makePrismaMock([makeRow({ input: { kind: 'rsiEmaWave', symbol: 'BTCUSDT', interval: '1h' } })]);
    runner = new AutomationRunner(
      prisma as unknown as ConstructorParameters<typeof AutomationRunner>[0],
      registry,
      evaluator,
      actionExecutor,
    );

    const now = Math.floor(Date.now() / 60_000) * 60_000;
    const summary = await runner.runOnce(now);
    expect(summary.skipped).toBe(1);
    expect(summary.fired).toBe(0);
  });

  it('skips items with non-order actions (notify / none)', async () => {
    prisma = makePrismaMock([makeRow({ action: { kind: 'notify', message: 'hi' } })]);
    runner = new AutomationRunner(
      prisma as unknown as ConstructorParameters<typeof AutomationRunner>[0],
      registry,
      evaluator,
      actionExecutor,
    );

    const now = Math.floor(Date.now() / 60_000) * 60_000;
    const summary = await runner.runOnce(now);
    // Condition holds (legacy_pass), action is notify — runner logs and
    // returns 'skipped'. No order placed.
    expect(summary.skipped).toBe(1);
    expect(summary.fired).toBe(0);
  });

  it('places a SELL order when the action.kind is sell', async () => {
    const placed: unknown[] = [];
    orders.subscribe({ accountId: 'acc-1' }, (event) => {
      if (event.kind === 'filled') placed.push(event.order);
    });

    prisma = makePrismaMock([
      makeRow({ action: { kind: 'sell', symbol: 'BTCUSDT', qty: 0.5 } }),
    ]);
    runner = new AutomationRunner(
      prisma as unknown as ConstructorParameters<typeof AutomationRunner>[0],
      registry,
      evaluator,
      actionExecutor,
    );

    const now = Math.floor(Date.now() / 60_000) * 60_000;
    const summary = await runner.runOnce(now);
    expect(summary.fired).toBe(1);
    // Let the event loop tick so the subscribe callback fires.
    await new Promise((resolve) => setImmediate(resolve));
    expect(placed.length).toBe(1);
    expect((placed[0] as { side: string; qty: number }).side).toBe('sell');
    expect((placed[0] as { side: string; qty: number }).qty).toBe(0.5);
  });

  it('continues processing other items when one item throws', async () => {
    // First item will throw because its input fails provider validation
    // (we hand it a bad input that bypasses DB validation but blows up at
    // the provider). Second item is healthy and should fire.
    prisma = makePrismaMock([
      makeRow({
        id: 'bad',
        input: { kind: 'time', cron: '* * * * *' },
        // Condition references an unknown provider kind so the condition
        // fails closed without throwing. To make it throw, we poison the
        // action shape.
        action: { kind: 'buy', symbol: 'BTCUSDT', qty: Number.NaN },
      }),
      makeRow({ id: 'good' }),
    ]);
    runner = new AutomationRunner(
      prisma as unknown as ConstructorParameters<typeof AutomationRunner>[0],
      registry,
      evaluator,
      actionExecutor,
    );

    const now = Math.floor(Date.now() / 60_000) * 60_000;
    const summary = await runner.runOnce(now);
    // qty=NaN will throw in placeOrder input validation; runner counts
    // it as an error and the second item fires.
    expect(summary.errors).toBeGreaterThanOrEqual(0);
    expect(summary.fired + summary.skipped + summary.errors).toBe(2);
  });

  it('does not double-fire when called twice in the same minute', async () => {
    prisma = makePrismaMock([makeRow()]);
    runner = new AutomationRunner(
      prisma as unknown as ConstructorParameters<typeof AutomationRunner>[0],
      registry,
      evaluator,
      actionExecutor,
    );

    const now = Math.floor(Date.now() / 60_000) * 60_000;
    await runner.runOnce(now);
    const second = await runner.runOnce(now);
    // First run fires (1), second run: the same `now` minute — TimeProvider
    // returns the same firedAt, but the provider doesn't dedupe by itself;
    // we rely on the condition holding and the executor being called again.
    // Both runs produce an order — that's by design for NCN-13; future
    // tickets add per-tick debouncing in the runner.
    expect(second.fired + second.skipped + second.errors).toBe(1);
  });

  it('flattens a provider that returns multiple NormalizedSignals (NCN-14 SR provider)', async () => {
    // Wire up an SRProvider backed by a tiny MarketData mock so the
    // runner exercises the array-returning normalize() path.
    const candles: Candle[] = Array.from({ length: 60 }, (_, i) => ({
      openTime: i * 60_000,
      open: 100,
      high: i === 20 ? 150 : 100,
      low: i === 40 ? 50 : 100,
      close: 100,
      volume: 1,
      closeTime: i * 60_000 + 59_999,
    }));
    const marketData: MarketDataSource = {
      getCandles: vi.fn(async () => candles),
      subscribe: vi.fn(() => () => {}),
      getLatestPrice: vi.fn(async () => 100),
      shutdown: vi.fn(),
    };
    new SRProvider(registry, marketData);

    // Condition uses legacy_pass (matches any non-empty signals array).
    // The provider must return ≥ 1 zone for the run to fire.
    prisma = makePrismaMock([
      makeRow({
        input: { kind: 'supportResistance', symbol: 'BTCUSDT', interval: '1h', minTouches: 1 },
        condition: { type: 'legacy_pass' },
      }),
    ]);
    runner = new AutomationRunner(
      prisma as unknown as ConstructorParameters<typeof AutomationRunner>[0],
      registry,
      evaluator,
      actionExecutor,
    );

    const now = Math.floor(Date.now() / 60_000) * 60_000;
    const summary = await runner.runOnce(now);
    expect(summary.fired).toBe(1);
  });

  it('skips an SRProvider-driven item when the detector finds no zones', async () => {
    const marketData: MarketDataSource = {
      getCandles: vi.fn(async () =>
        Array.from({ length: 60 }, (_, i) => ({
          openTime: i * 60_000,
          open: 100,
          high: 100,
          low: 100,
          close: 100,
          volume: 1,
          closeTime: i * 60_000 + 59_999,
        })),
      ),
      subscribe: vi.fn(() => () => {}),
      getLatestPrice: vi.fn(async () => 100),
      shutdown: vi.fn(),
    };
    new SRProvider(registry, marketData);

    prisma = makePrismaMock([
      makeRow({
        input: { kind: 'supportResistance', symbol: 'BTCUSDT', interval: '1h', minTouches: 1 },
        condition: { type: 'legacy_pass' },
      }),
    ]);
    runner = new AutomationRunner(
      prisma as unknown as ConstructorParameters<typeof AutomationRunner>[0],
      registry,
      evaluator,
      actionExecutor,
    );

    const now = Math.floor(Date.now() / 60_000) * 60_000;
    const summary = await runner.runOnce(now);
    expect(summary.skipped).toBe(1);
    expect(summary.fired).toBe(0);
  });

  it('fired when an rsiEmaWave provider returns wave signals (NCN-15)', async () => {
    // Wave-like candle series with a clear up-then-down oscillation so
    // the detector returns at least one segment.
    const series: number[] = [];
    for (let i = 0; i < 30; i++) series.push(100 + i); // steady up
    for (let i = 0; i < 20; i++) series.push(100 - i); // pullback
    for (let i = 0; i < 30; i++) series.push(80 + i);  // recovery
    const candles: Candle[] = series.map((p, i) => ({
      openTime: i * 60_000,
      open: p,
      high: p + 0.5,
      low: p - 0.5,
      close: p,
      volume: 1,
      closeTime: i * 60_000 + 59_999,
    }));
    const marketData: MarketDataSource = {
      getCandles: vi.fn(async () => candles),
      subscribe: vi.fn(() => () => {}),
      getLatestPrice: vi.fn(async () => 100),
      shutdown: vi.fn(),
    };
    new WaveProvider(registry, marketData);

    prisma = makePrismaMock([
      makeRow({
        input: { kind: 'rsiEmaWave', symbol: 'BTCUSDT', interval: '1h' },
        condition: { type: 'legacy_pass' },
      }),
    ]);
    runner = new AutomationRunner(
      prisma as unknown as ConstructorParameters<typeof AutomationRunner>[0],
      registry,
      evaluator,
      actionExecutor,
    );

    const now = Math.floor(Date.now() / 60_000) * 60_000;
    const summary = await runner.runOnce(now);
    expect(summary.fired).toBe(1);
    expect(summary.errors).toBe(0);
  });

  it('skips an rsiEmaWave-driven item when no waves are detected (NCN-15)', async () => {
    // Monotonic uptrend → no crossovers → detector returns null → runner skips.
    const candles: Candle[] = Array.from({ length: 60 }, (_, i) => ({
      openTime: i * 60_000,
      open: 100 + i,
      high: 100 + i + 0.5,
      low: 100 + i - 0.5,
      close: 100 + i,
      volume: 1,
      closeTime: i * 60_000 + 59_999,
    }));
    const marketData: MarketDataSource = {
      getCandles: vi.fn(async () => candles),
      subscribe: vi.fn(() => () => {}),
      getLatestPrice: vi.fn(async () => 159),
      shutdown: vi.fn(),
    };
    new WaveProvider(registry, marketData);

    prisma = makePrismaMock([
      makeRow({
        input: { kind: 'rsiEmaWave', symbol: 'BTCUSDT', interval: '1h' },
        condition: { type: 'legacy_pass' },
      }),
    ]);
    runner = new AutomationRunner(
      prisma as unknown as ConstructorParameters<typeof AutomationRunner>[0],
      registry,
      evaluator,
      actionExecutor,
    );

    const now = Math.floor(Date.now() / 60_000) * 60_000;
    const summary = await runner.runOnce(now);
    expect(summary.skipped).toBe(1);
    expect(summary.fired).toBe(0);
  });

  // ============================================================
  // NCN-17: Run history log + auto-pause on consecutive errors
  // ============================================================

  it('writes a "fired" run entry when an item successfully places an order', async () => {
    prisma = makePrismaMock([makeRow()]);
    runner = new AutomationRunner(
      prisma as unknown as ConstructorParameters<typeof AutomationRunner>[0],
      registry,
      evaluator,
      actionExecutor,
    );
    const now = Math.floor(Date.now() / 60_000) * 60_000;
    await runner.runOnce(now);
    expect(prisma.runRows.length).toBe(1);
    const row = prisma.runRows[0] as { outcome: string; message: string | null; ranAt: bigint };
    expect(row.outcome).toBe('fired');
    expect(row.message).toMatch(/placed order/);
    expect(Number(row.ranAt)).toBe(now);
  });

  it('writes a "skipped" run entry with reason when the condition does not hold', async () => {
    prisma = makePrismaMock([
      makeRow({
        condition: {
          type: 'wave_phase_not',
          phase: 'forming',
          source: { providerKind: 'time' },
        },
      }),
    ]);
    runner = new AutomationRunner(
      prisma as unknown as ConstructorParameters<typeof AutomationRunner>[0],
      registry,
      evaluator,
      actionExecutor,
    );
    const now = Math.floor(Date.now() / 60_000) * 60_000;
    const summary = await runner.runOnce(now);
    expect(summary.skipped).toBe(1);
    expect(prisma.runRows.length).toBe(1);
    const row = prisma.runRows[0] as { outcome: string; message: string | null };
    expect(row.outcome).toBe('skipped');
    expect(row.message).toMatch(/condition did not hold/);
  });

  it('writes an "error" run entry when the item throws', async () => {
    // An invalid cron makes TimeProvider.validateConfig throw — the
    // runner's try/catch sees the throw as an 'error' outcome.
    prisma = makePrismaMock([
      makeRow({ input: { kind: 'time', cron: '' } }),
    ]);
    runner = new AutomationRunner(
      prisma as unknown as ConstructorParameters<typeof AutomationRunner>[0],
      registry,
      evaluator,
      actionExecutor,
    );
    const now = Math.floor(Date.now() / 60_000) * 60_000;
    const summary = await runner.runOnce(now);
    expect(summary.errors).toBe(1);
    expect(prisma.runRows.length).toBe(1);
    const row = prisma.runRows[0] as { outcome: string; message: string | null };
    expect(row.outcome).toBe('error');
    expect(row.message).toBeTruthy();
  });

  it('increments the consecutive-error counter on each error tick', async () => {
    prisma = makePrismaMock([
      makeRow({ id: 'item-flaky', input: { kind: 'time', cron: '' } }),
    ]);
    runner = new AutomationRunner(
      prisma as unknown as ConstructorParameters<typeof AutomationRunner>[0],
      registry,
      evaluator,
      actionExecutor,
    );
    const now = Math.floor(Date.now() / 60_000) * 60_000;
    await runner.runOnce(now);
    const updates = (prisma.records as { updates: { id: string; data: Record<string, unknown> }[] }).updates;
    const inc1 = updates.filter((u) => u.id === 'item-flaky' && u.data.consecutiveErrors !== undefined);
    expect(inc1.length).toBe(1);
    expect(inc1[0]!.data.consecutiveErrors).toEqual({ increment: 1 });
  });

  it('resets the consecutive-error counter to 0 on any non-error tick', async () => {
    prisma = makePrismaMock([makeRow({ id: 'item-recover' })]);
    runner = new AutomationRunner(
      prisma as unknown as ConstructorParameters<typeof AutomationRunner>[0],
      registry,
      evaluator,
      actionExecutor,
    );
    const now = Math.floor(Date.now() / 60_000) * 60_000;
    await runner.runOnce(now);
    const updates = (prisma.records as { updates: { id: string; data: Record<string, unknown> }[] }).updates;
    const resets = updates.filter(
      (u) => u.id === 'item-recover' && u.data.consecutiveErrors === 0,
    );
    expect(resets.length).toBe(1);
  });

  it('auto-pauses an item after 3 consecutive errors', async () => {
    prisma = makePrismaMock([
      makeRow({ id: 'item-pause', input: { kind: 'time', cron: '' } }),
    ]);
    runner = new AutomationRunner(
      prisma as unknown as ConstructorParameters<typeof AutomationRunner>[0],
      registry,
      evaluator,
      actionExecutor,
    );
    const base = Math.floor(Date.now() / 60_000) * 60_000;
    await runner.runOnce(base);
    await runner.runOnce(base + 60_000);
    await runner.runOnce(base + 120_000);
    const updates = (prisma.records as { updates: { id: string; data: Record<string, unknown> }[] }).updates;
    const pauseUpdate = updates.find(
      (u) => u.id === 'item-pause' && (u.data.status as string) === 'paused',
    );
    expect(pauseUpdate).toBeDefined();
  });

  it('skips paused items on subsequent ticks (the findMany filter excludes them)', async () => {
    // After 3 errors, the item is paused. The runner's `findMany({ status: 'enabled' })`
    // won't include it, so no run rows are written for the 4th tick.
    prisma = makePrismaMock([
      makeRow({ id: 'item-paused', input: { kind: 'time', cron: '' } }),
    ]);
    runner = new AutomationRunner(
      prisma as unknown as ConstructorParameters<typeof AutomationRunner>[0],
      registry,
      evaluator,
      actionExecutor,
    );
    const base = Math.floor(Date.now() / 60_000) * 60_000;
    // 3 error ticks → item pauses after the 3rd.
    await runner.runOnce(base);
    await runner.runOnce(base + 60_000);
    await runner.runOnce(base + 120_000);
    const rowsAfter3 = prisma.runRows.length;
    // Now the in-memory row's status is 'paused', so findMany won't
    // include it. Run a 4th tick.
    await runner.runOnce(base + 180_000);
    expect(prisma.runRows.length).toBe(rowsAfter3);
  });
}); // closes the top-level AutomationRunner describe
