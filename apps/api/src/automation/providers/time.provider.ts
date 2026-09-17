import { BadRequestException, Injectable } from '@nestjs/common';
import { Cron } from 'croner';
import type { NormalizedSignal } from '@workspace/shared';
import { Provider, type ProviderContext } from './provider.abstract.js';
import { ProviderRegistry } from './provider.registry.js';

/**
 * 5-field cron syntax: minute hour day-of-month month day-of-week.
 * croner accepts the same surface we already validate against
 * (`* * * * *` style), so we keep the existing regex check at the API
 * boundary and only use croner for the actual matching here.
 */
const CRON_FIELD_RE = /^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/;

export interface TimeConfig {
  cron: string;
}

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
 * Other providers (RSI+EMA, ZigZag, S/R) follow the same shape:
 *   - extend Provider<TConfig, TRawSignal>
 *   - implement validateConfig, evaluate, normalize
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
    if (typeof raw !== 'object' || raw === null) {
      throw new BadRequestException('time config must be an object');
    }
    const cron = (raw as { cron?: unknown }).cron;
    if (typeof cron !== 'string' || !CRON_FIELD_RE.test(cron.trim())) {
      throw new BadRequestException(
        'time config: cron must be a 5-field cron expression',
      );
    }
    // Verify the cron actually parses — croner throws on bad expressions
    // that the field regex lets through (e.g. "60 * * * *").
    try {
      new Cron(cron.trim());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'invalid cron';
      throw new BadRequestException(`time config: ${message}`);
    }
    return { cron: cron.trim() };
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
