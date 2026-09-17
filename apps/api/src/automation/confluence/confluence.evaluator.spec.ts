import type { ConfluenceRule, NormalizedSignal } from '@workspace/shared';
import { ConfluenceEvaluator } from './confluence.evaluator.js';

function signal(overrides: Partial<NormalizedSignal> = {}): NormalizedSignal {
  return {
    direction: 'up',
    phase: 'developing',
    degree: 'micro',
    timeRange: { start: 0, end: 1 },
    source: { providerKind: 'rsiEmaWave', timeframe: '1h', symbol: 'BTCUSDT' },
    ...overrides,
  };
}

function rule(
  operator: 'and' | 'or',
  predicates: { providerKind: string; degree?: string; direction?: 'up' | 'down' }[],
): ConfluenceRule {
  return { operator, predicates };
}

describe('ConfluenceEvaluator', () => {
  const ev = new ConfluenceEvaluator();

  it('returns false for an empty predicate list', () => {
    expect(ev.evaluate(rule('and', []), [])).toBe(false);
  });

  it('AND returns true only when every predicate matches at least one signal', () => {
    const signals = [
      signal({ source: { providerKind: 'rsiEmaWave' }, direction: 'up', degree: 'micro' }),
      signal({ source: { providerKind: 'zigzag' }, direction: 'up', degree: 'macro' }),
    ];
    expect(
      ev.evaluate(
        rule('and', [
          { providerKind: 'rsiEmaWave', direction: 'up' },
          { providerKind: 'zigzag', direction: 'up' },
        ]),
        signals,
      ),
    ).toBe(true);
    expect(
      ev.evaluate(
        rule('and', [
          { providerKind: 'rsiEmaWave', direction: 'up' },
          { providerKind: 'zigzag', direction: 'down' },
        ]),
        signals,
      ),
    ).toBe(false);
  });

  it('OR returns true when any predicate matches', () => {
    const signals = [signal({ direction: 'down', degree: 'micro' })];
    expect(
      ev.evaluate(
        rule('or', [
          { providerKind: 'rsiEmaWave', direction: 'up' },
          { providerKind: 'rsiEmaWave', direction: 'down' },
        ]),
        signals,
      ),
    ).toBe(true);
  });

  it('degree filter narrows matching (peer comparison: same degree)', () => {
    const signals = [
      signal({ degree: 'micro', direction: 'up' }),
      signal({ degree: 'macro', direction: 'down' }),
    ];
    // Both predicates ask for degree=micro → only the first matches
    expect(
      ev.evaluate(
        rule('and', [
          { providerKind: 'rsiEmaWave', degree: 'micro', direction: 'up' },
          { providerKind: 'rsiEmaWave', degree: 'micro', direction: 'down' },
        ]),
        signals,
      ),
    ).toBe(false);
    expect(
      ev.evaluate(
        rule('or', [
          { providerKind: 'rsiEmaWave', degree: 'micro', direction: 'up' },
          { providerKind: 'rsiEmaWave', degree: 'micro', direction: 'down' },
        ]),
        signals,
      ),
    ).toBe(true);
  });

  it('different degrees work for containment-style rules', () => {
    const signals = [
      signal({ degree: 'micro', direction: 'up' }),
      signal({ degree: 'macro', direction: 'up' }),
    ];
    expect(
      ev.evaluate(
        rule('and', [
          { providerKind: 'rsiEmaWave', degree: 'micro', direction: 'up' },
          { providerKind: 'rsiEmaWave', degree: 'macro', direction: 'up' },
        ]),
        signals,
      ),
    ).toBe(true);
  });

  it('providerKind is the primary discriminator', () => {
    const signals = [
      signal({ source: { providerKind: 'zigzag' }, direction: 'up' }),
    ];
    expect(
      ev.evaluate(
        rule('and', [{ providerKind: 'rsiEmaWave', direction: 'up' }]),
        signals,
      ),
    ).toBe(false);
    expect(
      ev.evaluate(
        rule('and', [{ providerKind: 'zigzag', direction: 'up' }]),
        signals,
      ),
    ).toBe(true);
  });
});
