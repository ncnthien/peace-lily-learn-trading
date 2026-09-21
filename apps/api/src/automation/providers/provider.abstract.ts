import type {
  NormalizedSignal,
  Timeframe,
} from '@workspace/shared';

/**
 * Per-call context passed to a Provider.evaluate(). Most providers need
 * symbol + timeframe to know what to read; some (TimeProvider) only need
 * `now`. Add fields here as new providers need them.
 */
export interface ProviderContext {
  /** Symbol the provider should read, e.g. 'BTCUSDT' */
  symbol?: string;
  /** Timeframe to read, e.g. '1h' */
  timeframe?: Timeframe;
  /** Current epoch ms — used by time-based providers */
  now: number;
}

/**
 * Strategy interface for Automation signal generators. Each concrete
 * provider implements one of these and self-registers with the
 * ProviderRegistry in its constructor.
 *
 * Adding a new provider requires:
 *   1. A unique `kind` string (matches AutomationInput discriminator).
 *   2. `validateConfig` that returns the typed config or throws.
 *   3. `evaluate` that returns the raw signal (provider-specific shape).
 *   4. `normalize` that converts the raw signal to NormalizedSignal.
 *
 * The Confluence layer consumes only NormalizedSignal — providers never
 * see each other's data.
 */
export abstract class Provider<TConfig, TRawSignal> {
  /** Stable string identifying this provider. Must match AutomationInput.kind. */
  abstract readonly kind: string;

  /** Validate the raw config from the API; throw on invalid. */
  abstract validateConfig(raw: unknown): TConfig;

  /**
   * Evaluate the latest state for this provider. Return null when there is
   * no current signal (e.g. waiting for the next indicator tick).
   */
  abstract evaluate(ctx: ProviderContext & { config: TConfig }): Promise<TRawSignal | null>;

  /**
   * Convert the raw signal to the shared NormalizedSignal shape.
   *
   * Most providers emit exactly one NormalizedSignal per evaluation
   * (e.g. {@link TimeProvider}). Providers whose raw signal represents
   * multiple distinct events — currently SRProvider, which detects
   * N zones — return an array; the runner flattens both shapes into
   * EvalContext.signals.
   *
   * The `ctx` parameter is optional: providers that need no per-tick
   * context (e.g. TimeProvider, which has all info on the raw signal)
   * may omit it; providers that consume `ctx.symbol` or `ctx.now` for
   * normalization (e.g. to stamp timestamps / source) pass it through.
   * Declaring it optional keeps the base signature permissive while
   * letting runners always pass `ctx` for free.
   */
  abstract normalize(
    raw: TRawSignal,
    ctx?: ProviderContext,
  ): NormalizedSignal | NormalizedSignal[];
}
