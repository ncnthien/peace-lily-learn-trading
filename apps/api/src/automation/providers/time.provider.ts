import { BadRequestException, Injectable } from '@nestjs/common';
import { Cron } from 'croner';
import type { NormalizedSignal, TimeConfig } from '@workspace/shared';
import { TimeInputSchema } from '@workspace/shared';
import { Provider, type ProviderContext } from './provider.abstract.js';
import { ProviderRegistry } from './provider.registry.js';
import { badRequestFromZod } from './zod-bad-request.js';

/**
 * Raw output of TimeProvider — a "fired" signal with the fire timestamp.
 * Providers are free to use whatever shape makes sense for their
 * normalize() output.
 */
export interface TimeSignal {
  firedAt: number;
}

/**
 * Reference implementation of the Provider interface. Triggers whenever
 * the configured cron expression matches `now`. We use croner to evaluate
 * the match — the @nestjs/schedule runner calls us every minute and we
 * return null (no fire) when the cron doesn't match the current minute.
 *
 * `validateConfig` is Zod-driven (project convention): structural shape
 * + format (5-field cron regex) via the shared `TimeConfigSchema`. We
 * add a tiny semantic check after the parse because croner is stricter
 * than the field regex — `60 * * * *` passes the regex but fails croner.
 *
 * Other providers follow the same shape:
 *   - extend Provider<TConfig, TRawSignal>
 *   - validateConfig calls the matching shared XxxConfigSchema.parse()
 *     and re-throws ZodError as BadRequestException at the boundary
 *   - implement evaluate, normalize
 *   - register with ProviderRegistry in the constructor
 */
@Injectable()
export class TimeProvider extends Provider<TimeConfig, TimeSignal> {
  readonly kind = 'time';

  constructor(registry: ProviderRegistry) {
    super();
    registry.register(this);
  }

  validateConfig(raw: unknown): TimeConfig {
    // Validation is Zod-driven via the shared TimeInputSchema (the
    // project convention). The schema inherits the structural rules
    // from TimeConfigBase, so the 5-field cron regex + the strict
    // shape are shared with the API edge.
    let input: { kind: 'time'; cron: string };
    try {
      input = TimeInputSchema.parse(raw);
    } catch (err) {
      badRequestFromZod(err, 'time config is invalid');
    }
    // croner rejects things the regex lets through (e.g. minute > 59).
    try {
      new Cron(input.cron);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'invalid cron';
      throw new BadRequestException(`time config cron: ${message}`);
    }
    // Strip the `kind` discriminator — runners hand providers an inner
    // typed config, not the full discriminated input.
    return { cron: input.cron };
  }

  /**
   * Real cron matching. Returns null when the cron doesn't match the
   * current minute, so the runner can skip the item without invoking the
   * rest of the pipeline. We evaluate against the minute-aligned
   * timestamp because the runner ticks once per minute — sub-minute
   * precision isn't useful here.
   *
   * Strategy: ask croner "what's the next run after one millisecond
   * before this minute starts?" If that next run lands exactly on this
   * minute's start, the cron fires this minute. Otherwise it doesn't.
   * We could also use `previousRun` (no-arg in croner 10), but it's
   * pinned to wall-clock now which makes the test brittle.
   */
  async evaluate(
    ctx: ProviderContext & { config: TimeConfig },
  ): Promise<TimeSignal | null> {
    const cron = new Cron(ctx.config.cron, { timezone: 'UTC' });
    const minuteStart = Math.floor(ctx.now / 60_000) * 60_000;
    // Look back one millisecond so nextRun finds the current minute if
    // the cron matches it (instead of jumping to the next matching minute).
    const next = cron.nextRun(new Date(minuteStart - 1));
    if (next !== null && next.getTime() === minuteStart) {
      return { firedAt: minuteStart };
    }
    return null;
  }

  normalize(raw: TimeSignal): NormalizedSignal {
    return {
      direction: 'up',
      phase: 'forming',
      degree: 'macro',
      timeRange: { start: raw.firedAt, end: raw.firedAt },
      source: { providerKind: this.kind },
    };
  }
}
