import { z } from 'zod';
import {
  AUTOMATION_STATUSES,
  AutomationItemStatus,
} from '../enums/automation.js';
import { TimeframeSchema } from './domain.js';

export const AutomationItemStatusSchema = z.enum(
  AUTOMATION_STATUSES as unknown as readonly [AutomationItemStatus, ...AutomationItemStatus[]],
);

// ============================================================
// AutomationInput (NCN-12 + NCN-13)
// Discriminated union over `kind`. Adding a new provider kind
// means adding a new variant here; TypeScript and runtime both
// get the new shape automatically.
// ============================================================

export const TimeConfigSchema = z
  .object({
    cron: z
      .string()
      .trim()
      .regex(/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/, 'cron must be a 5-field cron expression'),
  })
  .strict();

export const AutomationInputSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('rsiEmaWave'),
      symbol: z.string().min(1),
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
    .strict(),
  z
    .object({
      kind: z.literal('supportResistance'),
      symbol: z.string().min(1),
      interval: TimeframeSchema,
      minTouches: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('time'),
      cron: z.string().trim(),
    })
    .strict(),
]);

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
export type TimeConfig = z.infer<typeof TimeConfigSchema>;
