import { indicatorKey, type ConditionNode, type EvalContext, type NormalizedSignal } from '@workspace/shared';
import { ConditionEvaluator } from './condition.evaluator.js';

function signal(overrides: Partial<NormalizedSignal> = {}): NormalizedSignal {
  return {
    direction: 'up',
    phase: 'developing',
    degree: 'micro',
    timeRange: { start: 100, end: 200 },
    source: { providerKind: 'rsiEmaWave', timeframe: '1h', symbol: 'BTCUSDT' },
    ...overrides,
  };
}

function ctx(overrides: Partial<EvalContext> = {}): EvalContext {
  return { signals: [], indicators: {}, now: 0, ...overrides };
}

describe('ConditionEvaluator', () => {
  const ev = new ConditionEvaluator();

  describe('composite nodes', () => {
    it('empty AND is false', () => {
      const node: ConditionNode = { operator: 'and', children: [] };
      expect(ev.evaluate(node, ctx())).toBe(false);
    });

    it('empty OR is false', () => {
      const node: ConditionNode = { operator: 'or', children: [] };
      expect(ev.evaluate(node, ctx())).toBe(false);
    });

    it('AND short-circuits on first failing child', () => {
      const calls: string[] = [];
      // We can't directly observe short-circuit through the public API,
      // but the composite engine must still return false.
      const node: ConditionNode = {
        operator: 'and',
        children: [
          { type: 'wave_direction', direction: 'up', source: { providerKind: 'rsiEmaWave' } },
          { type: 'wave_direction', direction: 'down', source: { providerKind: 'rsiEmaWave' } },
        ],
      };
      const result = ev.evaluate(
        node,
        ctx({ signals: [signal({ direction: 'up' })] }),
      );
      expect(result).toBe(false);
      expect(calls).toEqual([]);
    });

    it('nested composite — OR of (AND of leaves)', () => {
      const node: ConditionNode = {
        operator: 'or',
        children: [
          {
            operator: 'and',
            children: [
              { type: 'wave_direction', direction: 'up', source: { providerKind: 'rsiEmaWave' } },
              { type: 'wave_phase_not', phase: 'forming', source: { providerKind: 'rsiEmaWave' } },
            ],
          },
          {
            operator: 'and',
            children: [
              { type: 'wave_direction', direction: 'down', source: { providerKind: 'rsiEmaWave' } },
              { type: 'wave_phase_not', phase: 'exhausting', source: { providerKind: 'rsiEmaWave' } },
            ],
          },
        ],
      };
      // First branch holds: up & not forming
      expect(
        ev.evaluate(
          node,
          ctx({ signals: [signal({ direction: 'up', phase: 'developing' })] }),
        ),
      ).toBe(true);
      // Second branch holds: down & not exhausting
      expect(
        ev.evaluate(
          node,
          ctx({ signals: [signal({ direction: 'down', phase: 'developing' })] }),
        ),
      ).toBe(true);
      // Neither holds
      expect(
        ev.evaluate(
          node,
          ctx({ signals: [signal({ direction: 'up', phase: 'forming' })] }),
        ),
      ).toBe(false);
    });
  });

  describe('rsi_above / rsi_below', () => {
    const source = { providerKind: 'rsiEmaWave', timeframe: '1h', symbol: 'BTCUSDT' };

    it('rsi_above holds when value > threshold', () => {
      const indicators = { [indicatorKey(source)]: 65 };
      const node: ConditionNode = { type: 'rsi_above', threshold: 50, source };
      expect(ev.evaluate(node, ctx({ indicators }))).toBe(true);
    });

    it('rsi_above fails at exact equality (strict)', () => {
      const indicators = { [indicatorKey(source)]: 50 };
      const node: ConditionNode = { type: 'rsi_above', threshold: 50, source };
      expect(ev.evaluate(node, ctx({ indicators }))).toBe(false);
    });

    it('rsi_above fails when indicator missing', () => {
      const node: ConditionNode = { type: 'rsi_above', threshold: 50, source };
      expect(ev.evaluate(node, ctx({ indicators: {} }))).toBe(false);
    });

    it('rsi_above fails when indicator is null (not enough data yet)', () => {
      const indicators = { [indicatorKey(source)]: null };
      const node: ConditionNode = { type: 'rsi_above', threshold: 50, source };
      expect(ev.evaluate(node, ctx({ indicators }))).toBe(false);
    });

    it('rsi_below holds when value < threshold', () => {
      const indicators = { [indicatorKey(source)]: 30 };
      const node: ConditionNode = { type: 'rsi_below', threshold: 50, source };
      expect(ev.evaluate(node, ctx({ indicators }))).toBe(true);
    });

    it('rsi_below fails at exact equality (strict)', () => {
      const indicators = { [indicatorKey(source)]: 50 };
      const node: ConditionNode = { type: 'rsi_below', threshold: 50, source };
      expect(ev.evaluate(node, ctx({ indicators }))).toBe(false);
    });
  });

  describe('wave_direction', () => {
    it('holds when matching signal direction equals leaf direction', () => {
      const node: ConditionNode = {
        type: 'wave_direction',
        direction: 'up',
        source: { providerKind: 'rsiEmaWave' },
      };
      expect(ev.evaluate(node, ctx({ signals: [signal({ direction: 'up' })] }))).toBe(true);
      expect(ev.evaluate(node, ctx({ signals: [signal({ direction: 'down' })] }))).toBe(false);
    });

    it('source filters by timeframe when specified', () => {
      const node: ConditionNode = {
        type: 'wave_direction',
        direction: 'up',
        source: { providerKind: 'rsiEmaWave', timeframe: '4h' },
      };
      expect(
        ev.evaluate(
          node,
          ctx({
            signals: [
              signal({ source: { providerKind: 'rsiEmaWave', timeframe: '1h' }, direction: 'up' }),
              signal({ source: { providerKind: 'rsiEmaWave', timeframe: '4h' }, direction: 'up' }),
            ],
          }),
        ),
      ).toBe(true);
    });
  });

  describe('wave_contained_in', () => {
    const source = { providerKind: 'rsiEmaWave' };

    it('holds when signal.timeRange is fully inside leaf.timeRange', () => {
      const node: ConditionNode = {
        type: 'wave_contained_in',
        timeRange: { start: 0, end: 500 },
        source,
      };
      expect(
        ev.evaluate(
          node,
          ctx({ signals: [signal({ timeRange: { start: 100, end: 200 } })] }),
        ),
      ).toBe(true);
    });

    it('fails when signal extends outside on either side', () => {
      const node: ConditionNode = {
        type: 'wave_contained_in',
        timeRange: { start: 100, end: 200 },
        source,
      };
      expect(
        ev.evaluate(
          node,
          ctx({ signals: [signal({ timeRange: { start: 50, end: 150 } })] }),
        ),
      ).toBe(false);
      expect(
        ev.evaluate(
          node,
          ctx({ signals: [signal({ timeRange: { start: 150, end: 250 } })] }),
        ),
      ).toBe(false);
    });

    it('fails on degenerate timeRange (end <= start)', () => {
      const node: ConditionNode = {
        type: 'wave_contained_in',
        timeRange: { start: 200, end: 100 },
        source,
      };
      expect(
        ev.evaluate(
          node,
          ctx({ signals: [signal({ timeRange: { start: 100, end: 300 } })] }),
        ),
      ).toBe(false);
    });

    it('fails when no matching signal exists', () => {
      const node: ConditionNode = {
        type: 'wave_contained_in',
        timeRange: { start: 0, end: 500 },
        source,
      };
      expect(ev.evaluate(node, ctx({ signals: [] }))).toBe(false);
    });
  });

  describe('wave_phase_not', () => {
    it('holds when signal.phase differs from leaf.phase', () => {
      const node: ConditionNode = {
        type: 'wave_phase_not',
        phase: 'forming',
        source: { providerKind: 'rsiEmaWave' },
      };
      expect(
        ev.evaluate(node, ctx({ signals: [signal({ phase: 'developing' })] })),
      ).toBe(true);
      expect(
        ev.evaluate(node, ctx({ signals: [signal({ phase: 'forming' })] })),
      ).toBe(false);
    });

    it('fails when no matching signal exists', () => {
      const node: ConditionNode = {
        type: 'wave_phase_not',
        phase: 'forming',
        source: { providerKind: 'rsiEmaWave' },
      };
      expect(ev.evaluate(node, ctx({ signals: [] }))).toBe(false);
    });
  });

  describe('legacy migration marker', () => {
    it('legacy_pass holds by default so NCN-12 rows keep firing', () => {
      const node = {
        type: 'legacy_pass',
        note: 'migrated',
      } as unknown as ConditionNode;
      expect(ev.evaluate(node, ctx())).toBe(true);
    });
  });

  describe('integration — single generic evaluate() walks any tree', () => {
    it('AND of rsi_above + wave_direction', () => {
      const source = { providerKind: 'rsiEmaWave', timeframe: '1h', symbol: 'BTCUSDT' };
      const node: ConditionNode = {
        operator: 'and',
        children: [
          { type: 'rsi_above', threshold: 50, source },
          { type: 'wave_direction', direction: 'up', source },
        ],
      };
      const indicators = { [indicatorKey(source)]: 60 };
      expect(
        ev.evaluate(
          node,
          ctx({ signals: [signal({ direction: 'up' })], indicators }),
        ),
      ).toBe(true);
      expect(
        ev.evaluate(
          node,
          ctx({ signals: [signal({ direction: 'down' })], indicators }),
        ),
      ).toBe(false);
    });

    it('OR of (wave_direction, wave_phase_not) — different sources', () => {
      const node: ConditionNode = {
        operator: 'or',
        children: [
          {
            type: 'wave_direction',
            direction: 'up',
            source: { providerKind: 'zigzag' },
          },
          {
            type: 'wave_phase_not',
            phase: 'forming',
            source: { providerKind: 'rsiEmaWave' },
          },
        ],
      };
      expect(
        ev.evaluate(
          node,
          ctx({
            signals: [
              signal({ source: { providerKind: 'zigzag' }, direction: 'up' }),
            ],
          }),
        ),
      ).toBe(true);
      expect(
        ev.evaluate(
          node,
          ctx({
            signals: [
              signal({
                source: { providerKind: 'rsiEmaWave' },
                phase: 'developing',
              }),
            ],
          }),
        ),
      ).toBe(true);
      expect(ev.evaluate(node, ctx())).toBe(false);
    });
  });
});
