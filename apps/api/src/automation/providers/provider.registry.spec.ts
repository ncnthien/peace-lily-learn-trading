import { Provider } from './provider.abstract.js';
import { ProviderRegistry } from './provider.registry.js';

class FakeProvider extends Provider<{ foo: string }, { value: number }> {
  readonly kind = 'fake';
  validateConfig(): { foo: string } {
    return { foo: 'bar' };
  }
  async evaluate(): Promise<{ value: number }> {
    return { value: 1 };
  }
  normalize() {
    return {
      direction: 'up' as const,
      phase: 'developing' as const,
      degree: 'macro',
      timeRange: { start: 0, end: 1 },
      source: { providerKind: 'fake' },
    };
  }
}

class OtherFakeProvider extends FakeProvider {
  override readonly kind = 'other';
}

describe('ProviderRegistry', () => {
  it('registers and looks up by kind', () => {
    const reg = new ProviderRegistry();
    const p = new FakeProvider();
    reg.register(p);
    expect(reg.get('fake')).toBe(p);
    expect(reg.kinds()).toEqual(['fake']);
    expect(reg.list()).toHaveLength(1);
  });

  it('returns undefined for unknown kinds', () => {
    const reg = new ProviderRegistry();
    expect(reg.get('nope')).toBeUndefined();
  });

  it('throws when registering a duplicate kind', () => {
    const reg = new ProviderRegistry();
    reg.register(new FakeProvider());
    expect(() => reg.register(new FakeProvider())).toThrow(/already registered/);
  });

  it('supports multiple distinct providers', () => {
    const reg = new ProviderRegistry();
    const a = new FakeProvider();
    const b = new OtherFakeProvider();
    reg.register(a);
    reg.register(b);
    expect(reg.get('fake')).toBe(a);
    expect(reg.get('other')).toBe(b);
    expect(reg.kinds().sort()).toEqual(['fake', 'other']);
  });
});
