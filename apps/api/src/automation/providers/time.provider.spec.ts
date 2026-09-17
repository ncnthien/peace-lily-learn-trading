import { BadRequestException } from '@nestjs/common';
import { ProviderRegistry } from './provider.registry.js';
import { TimeProvider } from './time.provider.js';

describe('TimeProvider', () => {
  it('auto-registers itself as "time" on construction', () => {
    const reg = new ProviderRegistry();
    const provider = new TimeProvider(reg);
    expect(reg.get('time')).toBe(provider);
  });

  describe('validateConfig', () => {
    const reg = new ProviderRegistry();
    const provider = new TimeProvider(reg);

    it('accepts a valid 5-field cron expression', () => {
      expect(provider.validateConfig({ cron: '*/5 * * * *' })).toEqual({
        cron: '*/5 * * * *',
      });
    });

    it('trims whitespace from the cron string', () => {
      expect(provider.validateConfig({ cron: '  0 0 * * *  ' })).toEqual({
        cron: '0 0 * * *',
      });
    });

    it('rejects non-objects', () => {
      expect(() => provider.validateConfig('nope')).toThrow(BadRequestException);
    });

    it('rejects objects without a cron string', () => {
      expect(() => provider.validateConfig({})).toThrow(BadRequestException);
    });

    it('rejects malformed cron expressions', () => {
      expect(() => provider.validateConfig({ cron: 'not-a-cron' })).toThrow(
        BadRequestException,
      );
    });
  });

  describe('evaluate', () => {
    it('returns a fired-at timestamp', async () => {
      const reg = new ProviderRegistry();
      const provider = new TimeProvider(reg);
      const before = Date.now();
      const result = await provider.evaluate({
        config: { cron: '* * * * *' },
        now: before,
      });
      expect(result.firedAt).toBeGreaterThanOrEqual(before);
    });
  });

  describe('normalize', () => {
    const reg = new ProviderRegistry();
    const provider = new TimeProvider(reg);

    it('produces a NormalizedSignal tagged with this provider', () => {
      const signal = provider.normalize(
        { firedAt: 1234 },
        { now: 1234 },
      );
      expect(signal.source.providerKind).toBe('time');
      expect(signal.direction).toBe('up');
      expect(signal.phase).toBe('forming');
      expect(signal.degree).toBe('macro');
      expect(signal.timeRange).toEqual({ start: 1234, end: 1234 });
    });
  });
});
