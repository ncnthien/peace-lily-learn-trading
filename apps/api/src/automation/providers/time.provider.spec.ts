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
      expect(provider.validateConfig({ kind: 'time', cron: '*/5 * * * *' })).toEqual({
        cron: '*/5 * * * *',
      });
    });

    it('trims whitespace from the cron string', () => {
      expect(provider.validateConfig({ kind: 'time', cron: '  0 0 * * *  ' })).toEqual({
        cron: '0 0 * * *',
      });
    });

    it('rejects non-objects', () => {
      expect(() => provider.validateConfig('nope')).toThrow(BadRequestException);
    });

    it('rejects objects without a cron string', () => {
      expect(() => provider.validateConfig({ kind: 'time' })).toThrow(BadRequestException);
    });

    it('rejects malformed cron expressions', () => {
      expect(() => provider.validateConfig({ kind: 'time', cron: 'not-a-cron' })).toThrow(
        BadRequestException,
      );
    });

    it('rejects cron expressions with out-of-range fields (e.g. minute 60)', () => {
      expect(() => provider.validateConfig({ kind: 'time', cron: '60 * * * *' })).toThrow(
        BadRequestException,
      );
    });
  });

  describe('evaluate', () => {
    function makeProvider(): TimeProvider {
      return new TimeProvider(new ProviderRegistry());
    }

    it('fires when the cron matches the current minute (every-minute cron)', async () => {
      const provider = makeProvider();
      // Use a minute-aligned timestamp so the cron check is unambiguous.
      const minuteStart = Math.floor(Date.now() / 60_000) * 60_000;
      const result = await provider.evaluate({
        config: { cron: '* * * * *' },
        now: minuteStart,
      });
      expect(result).not.toBeNull();
      expect(result!.firedAt).toBe(minuteStart);
    });

    it('does not fire when the cron does not match the current minute', async () => {
      const provider = makeProvider();
      // Cron fires only at minute 0; pick a minute that's clearly not 0.
      // Use a deterministic timestamp (any minute other than :00) so the
      // test is timezone-independent.
      const minuteStart = Math.floor(Date.now() / 60_000) * 60_000;
      const nonZeroMinute = minuteStart % 3_600_000 < 60_000
        ? minuteStart + 60_000 // bump to next minute if we landed on :00
        : minuteStart;
      const result = await provider.evaluate({
        config: { cron: '0 * * * *' }, // every hour at :00
        now: nonZeroMinute,
      });
      expect(result).toBeNull();
    });

    it('rounds `now` down to the minute so sub-minute drift does not double-fire', async () => {
      const provider = makeProvider();
      const minuteStart = Math.floor(Date.now() / 60_000) * 60_000;
      const driftedNow = minuteStart + 17_000; // 17s into the minute
      const result = await provider.evaluate({
        config: { cron: '* * * * *' },
        now: driftedNow,
      });
      expect(result).not.toBeNull();
      expect(result!.firedAt).toBe(minuteStart);
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
