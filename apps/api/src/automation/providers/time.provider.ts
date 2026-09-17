import { BadRequestException, Injectable } from '@nestjs/common';
import type { NormalizedSignal } from '@workspace/shared';
import { Provider, type ProviderContext } from './provider.abstract.js';
import { ProviderRegistry } from './provider.registry.js';

/** Accepted 5-field cron syntax (minute hour day-of-month month day-of-week). */
const CRON_FIELD_RE = /^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/;

export interface TimeConfig {
  cron: string;
}

/**
 * Raw output of TimeProvider — currently just a "fired" signal with the
 * fire timestamp. Providers are free to use whatever shape makes sense
 * for their normalize() output.
 */
export interface TimeSignal {
  firedAt: number;
}

/**
 * Reference implementation of the Provider interface. Triggers whenever
 * its cron expression matches `now` (every minute). The full cron parser
 * is intentionally deferred — for foundation, we only check the shape.
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
    return { cron: cron.trim() };
  }

  // For the foundation, every evaluation "fires" — a more elaborate impl
  // would parse cron and only fire when matching. Callers should debounce
  // outside the provider if they need to.
  async evaluate(_ctx: ProviderContext & { config: TimeConfig }): Promise<TimeSignal> {
    return { firedAt: Date.now() };
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
