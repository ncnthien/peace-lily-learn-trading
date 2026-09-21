import { z } from 'zod';
import {
  AUTOMATION_STATUSES,
  AutomationItemStatus,
} from '../enums/automation.js';
import { TimeframeSchema } from './domain.js';
import type { Timeframe } from '../enums/timeframe.js';

export const AutomationItemStatusSchema = z.enum(
  AUTOMATION_STATUSES as unknown as readonly [AutomationItemStatus, ...AutomationItemStatus[]],
);

// ============================================================
// AutomationInput (NCN-12 + NCN-13)
// Discriminated union over `kind`. Adding a new provider kind
// means adding a new sub-schema here; the union picks it up
// automatically. There are TWO per-kind schemas for symmetry
// between wire shape (input) and validated inner shape (config):
//
//   - Per-kind *config* schema: validates the inner fields, applies
//     normalization transforms (trim / uppercase), and exports
//     the typed config shape. Providers call `.parse(raw)` on this
//     to do their runtime check via Zod — that's the project-wide
//     convention.
//   - Per-kind *input* schema: same field set with a literal `kind`
//     discriminator. Feeds the AutomationInputSchema discriminated
//     union used by the API edge / UI form.
//
// `transform()` lives only on the config schema — discriminated
// unions can't take ZodEffects as members.
// ============================================================

/**
 * Per-kind CONFIG schemas. These are what providers call inside
 * `validateConfig()`. The `.transform()` step canonicalizes the shape
 * so the rest of the pipeline can rely on trimmed whitespace and
 * upper-cased symbols without re-checking.
 *
 * Implementation note: each per-kind pair has a base `ZodObject`
 * (the structural validation rules) plus a thin `.transform()`
 * wrapper that returns the typed config. The base is reused so
 * the per-kind *input* schema (the discriminated-union variant) can
 * extend it — you can't reach `.shape` through a ZodPipe, so the
 * base is the shared source of truth.
 */

const TimeConfigBase = z
  .object({
    cron: z
      .string()
      .trim()
      .regex(
        /^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/,
        'cron must be a 5-field cron expression',
      ),
  })
  .strict();

export const TimeConfigSchema = TimeConfigBase.transform((v) => ({
  cron: v.cron.trim(),
}));
export type TimeConfig = z.infer<typeof TimeConfigSchema>;

const RsiEmaWaveConfigBase = z
  .object({
    symbol: z.string().trim().toUpperCase().min(1),
    interval: TimeframeSchema,
    /**
     * Minimum RSI delta (in RSI points) a wave segment must span from
     * start crossover to end crossover to survive noise filtering.
     * Defaults to 5 — the wave's "magnitude" must exceed this.
     */
    noiseThreshold: z.number().finite().nonnegative().optional(),
    /** Max candles to pull from MarketData. Defaults to 200. */
    candleLimit: z.number().int().positive().optional(),
  })
  .strict();

export const RsiEmaWaveConfigSchema = RsiEmaWaveConfigBase.transform((v) => {
  const out: {
    symbol: string;
    interval: Timeframe;
    noiseThreshold?: number;
    candleLimit?: number;
  } = { symbol: v.symbol, interval: v.interval };
  if (v.noiseThreshold !== undefined) out.noiseThreshold = v.noiseThreshold;
  if (v.candleLimit !== undefined) out.candleLimit = v.candleLimit;
  return out;
});
export type RsiEmaWaveConfig = z.infer<typeof RsiEmaWaveConfigSchema>;

const SupportResistanceConfigBase = z
  .object({
    symbol: z.string().trim().toUpperCase().min(1),
    interval: TimeframeSchema,
    minTouches: z.number().int().positive(),
  })
  .strict();

export const SupportResistanceConfigSchema = SupportResistanceConfigBase.transform(
  (v) => ({
    symbol: v.symbol.toUpperCase(),
    interval: v.interval,
    minTouches: v.minTouches,
  }),
);
export type SupportResistanceConfig = z.infer<typeof SupportResistanceConfigSchema>;

/**
 * Per-kind INPUT schemas (with literal `kind` discriminator). Used
 * inside the AutomationInputSchema discriminated union; the API edge
 * validates via `nestjs-zod`'s ZodValidationPipe against the union.
 *
 * These share the base ZodObject's validation rules with the config
 * schemas above so a single change to a field's constraint flows to
 * both layers automatically.
 */

export const TimeInputSchema = TimeConfigBase.extend({
  kind: z.literal('time'),
}).strict();

export const RsiEmaWaveInputSchema = RsiEmaWaveConfigBase.extend({
  kind: z.literal('rsiEmaWave'),
}).strict();

export const SupportResistanceInputSchema = SupportResistanceConfigBase.extend({
  kind: z.literal('supportResistance'),
}).strict();

export const AutomationInputSchema = z.discriminatedUnion('kind', [
  RsiEmaWaveInputSchema,
  SupportResistanceInputSchema,
  TimeInputSchema,
]);
// Order doesn't change runtime correctness (discriminator picks); the
// listing above is just what `AutomationInput.kind` will look like.

// ============================================================
// ConditionNode tree (NCN-27)
// Recursive: leaves + composites that nest children of ConditionNode.
// Use `z.lazy()` so the type self-references without infinite expansion.
// ============================================================

export const ConditionSourceSchema = z
  .object({
    providerKind: z.string().min(1),
    timeframe: z.string().optional(),
    symbol: z.string().optional(),
  })
  .strict();

export const LeafConditionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('rsi_above'),
      threshold: z.number().finite(),
      source: ConditionSourceSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('rsi_below'),
      threshold: z.number().finite(),
      source: ConditionSourceSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('wave_direction'),
      direction: z.enum(['up', 'down']),
      source: ConditionSourceSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('wave_contained_in'),
      timeRange: z
        .object({
          start: z.number().finite(),
          end: z.number().finite(),
        })
        .strict()
        .refine((r) => r.end > r.start, {
          message: 'timeRange.end must be greater than timeRange.start',
        }),
      source: ConditionSourceSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('wave_phase_not'),
      phase: z.enum(['forming', 'developing', 'exhausting']),
      source: ConditionSourceSchema,
    })
    .strict(),
]);

// Note: the `ConditionNode` type is declared in ../index.ts (it's the
// union of LeafCondition and { operator, children }). We declare the
// schema here as `z.ZodType<ConditionNode>` to preserve the concrete
// type across the recursive boundary.

/**
 * Forward-declared TS type so the recursive `ConditionNodeSchema` can
 * be typed as `z.ZodType<ConditionNode>` (rather than `unknown`). The
 * actual structural shape is the union of `LeafCondition` and the
 * composite `{ operator, children: ConditionNode[] }`. `index.ts`
 * re-exports this type as the public `ConditionNode`.
 *
 * Declared AFTER LeafConditionSchema so the z.infer reference is valid.
 */
export type ConditionNode =
  | z.infer<typeof LeafConditionSchema>
  | {
      operator: 'and' | 'or';
      children: ConditionNode[];
    };

export const CompositeConditionSchema = z
  .object({
    operator: z.enum(['and', 'or']),
    children: z.array(
      z.lazy(() => ConditionNodeSchema as unknown as z.ZodType<ConditionNode>),
    ),
  })
  .strict();

/**
 * The recursion trick: `z.lazy()` defers the implementation so the
 * schema can reference itself in the CompositeCondition's `children`
 * array without infinite expansion. Typed against `ConditionNode` so
 * `z.infer` and downstream narrowing still produce a concrete shape
 * (not `unknown`).
 */
export const ConditionNodeSchema: z.ZodType<ConditionNode> = z.lazy(() =>
  z.union([LeafConditionSchema, CompositeConditionSchema]) as unknown as z.ZodType<ConditionNode>,
);

// ============================================================
// Action / Output
// ============================================================

export const AutomationActionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('buy'),
      symbol: z.string().min(1),
      qty: z.number().finite().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('sell'),
      symbol: z.string().min(1),
      qty: z.number().finite().positive(),
    })
    .strict(),
]);

export const AutomationOutputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z
    .object({
      kind: z.literal('notify'),
      message: z.string().min(1),
    })
    .strict(),
]);

// ============================================================
// Item envelope
// ============================================================

export const CreateAutomationInputSchema = z
  .object({
    accountId: z.string().min(1),
    name: z.string().min(1).max(120),
    input: AutomationInputSchema,
    condition: ConditionNodeSchema,
    action: AutomationActionSchema,
    output: AutomationOutputSchema.optional(),
    status: AutomationItemStatusSchema.optional(),
  })
  .strict();

export const UpdateAutomationInputSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    input: AutomationInputSchema.optional(),
    condition: ConditionNodeSchema.optional(),
    action: AutomationActionSchema.optional(),
    output: AutomationOutputSchema.optional(),
    status: AutomationItemStatusSchema.optional(),
  })
  .strict();

export const AutomationItemSchema = z
  .object({
    id: z.string().min(1),
    accountId: z.string().min(1),
    name: z.string().min(1).max(120),
    input: AutomationInputSchema,
    condition: ConditionNodeSchema,
    action: AutomationActionSchema,
    output: AutomationOutputSchema,
    status: AutomationItemStatusSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export type CreateAutomationInput = z.infer<typeof CreateAutomationInputSchema>;
export type UpdateAutomationInput = z.infer<typeof UpdateAutomationInputSchema>;
export type AutomationItem = z.infer<typeof AutomationItemSchema>;
// ConditionNode is forward-declared above for the recursive schema;
// not re-inferred here because z.infer<typeof ConditionNodeSchema>
// would lose the concrete shape through z.lazy's ZodType<unknown> chain.
export type LeafCondition = z.infer<typeof LeafConditionSchema>;
export type CompositeCondition = z.infer<typeof CompositeConditionSchema>;
export type ConditionSource = z.infer<typeof ConditionSourceSchema>;
export type AutomationInput = z.infer<typeof AutomationInputSchema>;
export type AutomationAction = z.infer<typeof AutomationActionSchema>;
export type AutomationOutput = z.infer<typeof AutomationOutputSchema>;
// Per-kind typed configs (what the providers' `validateConfig`
// returns). `TimeConfig` is declared above via z.infer;
// `WaveConfig` / `SRConfig` here are convenience aliases for the
// matching configs so callers don't have to repeat the union
// member names.
export type {
  RsiEmaWaveConfig as WaveConfig,
  SupportResistanceConfig as SRConfig,
};

// ============================================================
// AutomationItem lifecycle (NCN-17)
// ============================================================

/**
 * Outcome of a single runner tick against an AutomationItem.
 * - `fired`   — condition held AND action was placed (or attempted).
 * - `skipped` — condition didn't hold, or the action produced no order.
 * - `error`   — provider / evaluator / executor threw. The runner
 *               keeps going; the engine records the outcome and the
 *               per-item consecutive-error counter ticks up.
 */
export const RunOutcomeSchema = z.enum(['fired', 'skipped', 'error']);
export type RunOutcome = z.infer<typeof RunOutcomeSchema>;

/**
 * One row in the run history log. The engine writes one per tick per
 * item (regardless of outcome). The web UI surfaces the last N entries
 * per row so users can see "did this rule fire recently? what's it
 * been doing?".
 */
export const AutomationRunSchema = z
  .object({
    id: z.string().min(1),
    automationItemId: z.string().min(1),
    outcome: RunOutcomeSchema,
    /** Human-readable detail — error message, skip reason, etc. */
    message: z.string().optional(),
    /** Epoch ms — mirrors Trade.createdAt convention. */
    ranAt: z.number().finite(),
  })
  .strict();
export type AutomationRun = z.infer<typeof AutomationRunSchema>;

/** Default page size for GET /automation/:id/runs */
export const RUN_LOG_DEFAULT_LIMIT = 20;
/** Hard ceiling for GET /automation/:id/runs */
export const RUN_LOG_MAX_LIMIT = 100;
