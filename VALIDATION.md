# Validation

This codebase validates everything that crosses an HTTP boundary through [Zod](https://zod.dev/) schemas defined in [`packages/shared/src/schemas/`](./packages/shared/src/schemas/). The schema is the single source of truth — both runtime validation and the TypeScript type come from the same place.

## Stack

| Layer | Library | Role |
|---|---|---|
| `packages/shared` | `zod` | Defines schemas and infers the matching TS types |
| `apps/api` | [`nestjs-zod`](https://github.com/BenLorantfy/nestjs-zod) | Validates `@Body()` / `@Query()` / `@Param()` at the controller boundary via `ZodValidationPipe` |
| `apps/web` | `zod` | Same schemas imported from `@workspace/shared`, used as a thin client-side guard in mutation hooks |

The web and the server share the **same** schema definitions — no drift possible.

## Anatomy of a schema

```ts
// packages/shared/src/schemas/automation.ts
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
  .strict();                                  // reject unknown keys

export type CreateAutomationInput = z.infer<typeof CreateAutomationInputSchema>;
```

- `.strict()` is the default for cross-API shapes — typos on the wire surface as 400 instead of being silently dropped.
- The TS type is `z.infer<...>` — never hand-written, never drifts.

## Recursive types (ConditionNode)

`ConditionNode` is a tree: leaves + composites that nest more `ConditionNode`. The recursion trick:

```ts
// 1. forward-declare the TS type so the schema can be typed against it
export type ConditionNode =
  | z.infer<typeof LeafConditionSchema>
  | { operator: 'and' | 'or'; children: ConditionNode[] };

// 2. declare the schema as z.ZodType<ConditionNode>
export const ConditionNodeSchema: z.ZodType<ConditionNode> = z.lazy(() =>
  z.union([LeafConditionSchema, CompositeConditionSchema]) as unknown as z.ZodType<ConditionNode>,
);
```

The `as unknown as z.ZodType<ConditionNode>` cast is needed because `z.lazy()` returns a generic `ZodLazy<unknown>` that TS can't narrow on its own. The cast preserves the concrete shape end-to-end so the rule engine (`apps/api/src/automation/rule-engine/condition.evaluator.ts`) keeps its `LeafCondition | CompositeCondition` narrowing.

## Server-side: `ZodValidationPipe`

Registered globally in `apps/api/src/main.ts`:

```ts
app.useGlobalPipes(new ZodValidationPipe(), new ValidationPipe({ whitelist: true }));
```

`ZodValidationPipe` reads the schema off `@Body()`-typed parameters — but it needs the schema to be attached to the parameter type. Use `createZodDto(Schema)` to make a class whose type metadata carries the schema:

```ts
// apps/api/src/automation/automation.controller.ts
import { createZodDto } from 'nestjs-zod';
import { CreateAutomationInputSchema } from '@workspace/shared';

class CreateAutomationDto extends createZodDto(CreateAutomationInputSchema) {}

@Post()
create(@Body() body: CreateAutomationInput) {
  // body has been parsed + validated against CreateAutomationInputSchema.
  // Its TS type is structurally identical to the inferred schema type.
  return this.automation.create(body);
}
```

Bad input throws `ZodValidationException` (400 Bad Request) before the handler runs, with a structured error payload.

## Client-side: thin guards

Server-side Zod is the source of truth. The web hooks also parse their mutation inputs through the same schemas, so bad inputs fail at the call site with a precise message instead of round-tripping:

```ts
// apps/web/src/hooks/use-accounts.ts
function parseOrThrow<T>(schema: { parse: (v: unknown) => T }, value: unknown, label: string): T {
  try {
    return schema.parse(value);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new Error(`${label}: ${err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
    }
    throw err;
  }
}
```

These guards are deliberately thin — they exist for fast feedback at the call site, not as a separate trust boundary.

## Why this layout

- **One source of truth.** Adding a new field to `AutomationItem` means adding it to `AutomationItemSchema`. The TS type, the API validation, and the client-side guard all pick it up.
- **No `interface` vs `class` drift.** Hand-written TS interfaces would always lag behind; `z.infer` cannot drift because it IS the type.
- **Bad input fails at the boundary, not deep inside.** The `assertShape` shim that used to live in `AutomationService` is gone — the pipe rejects bad condition trees before the handler runs.

## Adding a new schema

1. Add it to `packages/shared/src/schemas/<area>.ts` (or a new file).
2. Export both the schema and the inferred type: `export type X = z.infer<typeof XSchema>`.
3. Re-export from `packages/shared/src/schemas/index.ts`.
4. Re-export from `packages/shared/src/index.ts` if the type should be part of the public surface.
5. Server: create a `Dto extends createZodDto(Schema)` and use `@Body() body: InferredType` in the controller.
6. Web: import the schema into the relevant hook and wrap mutations with `parseOrThrow`.

## What stayed hand-written

- Enums (`Timeframe`, `AccountType`, `TradeSide`, etc.) are still `as const` objects — schemas are derived from `Object.values(Enum)` so adding a new enum value picks up automatically.
- `EvalContext` (the rule engine's internal type) stays as a hand-written `interface` because it never crosses an HTTP boundary.
- Provider `validateConfig` methods (e.g. `TimeProvider` parsing cron) stay as service-level validation — they handle provider-specific concerns (cron syntax, symbol whitelist) that don't belong in the cross-API schema.
