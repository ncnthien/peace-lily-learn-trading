# Automation

Three-layer architecture for the Automation engine (NCN-12) with a single
rule engine (NCN-27) driving trigger evaluation:

```
┌──────────────────────────────────────────────────────────────────────┐
│ PROVIDER  — independent modules that produce raw signals              │
│   e.g. RsiEmaWaveProvider, ZigZagProvider, TimeProvider, SRProvider   │
│   knows its own data source, nothing else                            │
└──────────────────────────────────────────────────────────────────────┘
                                ↓ normalize
┌──────────────────────────────────────────────────────────────────────┐
│ NORMALIZED SIGNAL — one shared shape so downstream logic can compare │
│   { direction, phase, degree, timeRange, source }                   │
└──────────────────────────────────────────────────────────────────────┘
                                ↓ evaluate()
┌──────────────────────────────────────────────────────────────────────┐
│ RULE ENGINE  — walks a ConditionNode tree against an EvalContext     │
│   { signals, indicators, now }     same code for live + backtest    │
│   leaves: rsi_above / rsi_below / wave_direction / wave_contained_in │
│           / wave_phase_not  (+ legacy_pass migration marker)         │
│   composites: AND / OR — recursive                                   │
└──────────────────────────────────────────────────────────────────────┘
```

## Layout

```
automation/
├── providers/
│   ├── provider.abstract.ts        # Strategy interface
│   ├── provider.registry.ts        # kind → Provider map
│   └── time.provider.ts            # Reference implementation (cron)
├── rule-engine/
│   └── condition.evaluator.ts     # walks ConditionNode trees
├── automation.module.ts
├── automation.service.ts           # CRUD on AutomationItem
├── automation.controller.ts        # HTTP
└── automation.runner.ts            # @Cron tick — provider → rule engine → action
```

## ConditionNode tree (NCN-27)

A `ConditionNode` is the single, JSON-serializable expression the engine
walks. It is recursive:

```ts
type ConditionNode = LeafCondition | CompositeCondition;

interface CompositeCondition {
  operator: 'and' | 'or';
  children: ConditionNode[];
}

type LeafCondition =
  | { type: 'rsi_above';       threshold: number;                     source: ConditionSource }
  | { type: 'rsi_below';       threshold: number;                     source: ConditionSource }
  | { type: 'wave_direction';  direction: 'up' | 'down';             source: ConditionSource }
  | { type: 'wave_contained_in'; timeRange: { start: number; end: number }; source: ConditionSource }
  | { type: 'wave_phase_not';  phase: 'forming' | 'developing' | 'exhausting'; source: ConditionSource };

interface ConditionSource {
  providerKind: string;   // matches a registered Provider.kind
  timeframe?: string;
  symbol?: string;
}
```

A bare leaf is a valid tree — AND/OR is only needed when composing
multiple checks.

`EvalContext` carries everything the leaves need:

```ts
interface EvalContext {
  signals: NormalizedSignal[];                      // from every Provider
  indicators?: Record<string, number | null>;       // key = providerKind:timeframe:symbol
  now: number;
}
```

The same `evaluate(node, ctx)` works for live automation (fresh ticks
into providers → EvalContext) and backtest (replayed candles → same
EvalContext shape).

## Runtime loop (NCN-13)

`automation.runner.ts` is the @Cron-decorated service that wires the
engine together end-to-end:

```
@Cron('* * * * *') AutomationRunner.onCronTick()
  └─ runOnce(now)
       for each enabled AutomationItem:
         provider.eval → normalize → EvalContext
         conditionEvaluator.evaluate(item.condition, ctx)
         if holds: orderExecution.placeOrder(item.action)
```

The runner is the only place a row in `AutomationItem` becomes an order
on an account. New provider kinds plug into the same loop — they just
need to be registered in `automation.module.ts` and the runner will
pick them up by `input.kind`. Multiple providers in scope for one tick
will be collected into a single `EvalContext.signals` array so cross-
provider rules (e.g. "time AND wave direction") work as-is.

Tests drive the runner via `runOnce(now)` — no need to wait for the
real cron tick.

## Adding a new Provider

The plugin pattern is the core of this architecture. Adding a new input
source (e.g. ZigZag wave detection, Support/Resistance touch, MACD
crossover) does NOT require touching the rule engine, the registry, or
the service. You only need to:

1. **Create the class** in `apps/api/src/automation/providers/<name>.provider.ts`:

   ```ts
   @Injectable()
   export class ZigZagProvider extends Provider<ZigZagConfig, ZigZagSignal> {
     readonly kind = 'zigzag';

     constructor(registry: ProviderRegistry) {
       super();
       registry.register(this);   // self-registers on instantiation
     }

     validateConfig(raw: unknown): ZigZagConfig {
       // throw BadRequestException on invalid; return typed config otherwise
     }

     async evaluate(ctx): Promise<ZigZagSignal | null> {
       // read candles, detect pivots, return raw signal
     }

     normalize(raw, ctx): NormalizedSignal {
       return {
         direction: raw.up ? 'up' : 'down',
         phase: 'developing',
         degree: 'micro',
         timeRange: { start: raw.start, end: raw.end },
         source: { providerKind: this.kind, timeframe: ctx.timeframe, symbol: ctx.symbol },
       };
     }
   }
   ```

2. **Register the provider** in `automation.module.ts`:

   ```ts
   providers: [
     // ...
     ZigZagProvider,   // <-- add here
   ],
   ```

3. **Add the kind to the `AutomationInput` discriminated union** in
   `packages/shared/src/index.ts`:

   ```ts
   export type AutomationInput =
     | { kind: 'time'; cron: string }
     | { kind: 'zigzag'; symbol: string; interval: Timeframe; threshold: number };
   ```

That's it. The service, controller, registry, evaluator, and UI all pick
up the new provider automatically. Each new provider is a self-contained
module that knows only about its own data source.

## Adding a new LeafCondition type

The rule engine is open to new leaf types without touching the engine
itself. You only need to:

1. **Extend the discriminated union** in `packages/shared/src/index.ts`:

   ```ts
   export type LeafCondition =
     | { type: 'rsi_above';       threshold: number; source: ConditionSource }
     | { type: 'macd_above_zero'; macdThreshold: number; source: ConditionSource }
     | /* ...existing variants */;
   ```

2. **Add a case to the evaluator's switch** in
   `apps/api/src/automation/rule-engine/condition.evaluator.ts`. The
   exhaustiveness guard (`const _exhaustive: never = leaf`) will fail to
   compile until you do:

   ```ts
   case 'macd_above_zero':
     return this.evalMacdAboveZero(leaf, ctx);
   ```

3. **Add a validator case to `assertLeafShape`** in the same file. This
   is what surfaces a 400 Bad Request when a malformed tree is posted
   via the API. UI composers and the API never accept a silently
   failing tree.

4. **Add the leaf to the UI summary** in
   `apps/web/src/app/automation/page.tsx` (`conditionSummary`):

   ```ts
   case 'macd_above_zero':
     return `MACD > ${String(leaf.macdThreshold)}`;
   ```

5. **Update the `LeafCondition` mirror type** in
   `apps/web/src/lib/api.ts` so the UI's TypeScript types match the
   shared contract.

That's it. The engine, registry, and persistence layer all pick up the
new leaf automatically — no migration needed (the tree is
JSON-serializable and lives in the existing `condition` Json column).

## Why this shape

- **Plugin-style** (Strategy pattern): new providers don't change the
  engine.
- **Normalized output** (Normalizer layer): leaves in the condition tree
  match against NormalizedSignal without knowing where the signal came
  from. Peer comparison (same degree, different source) and
  containment (different degree) fall out naturally from
  `signal.degree` + `signal.direction`.
- **Recursive tree, not flat list**: AND/OR composition is part of the
  data, not a separate array. Same `evaluate()` walks any shape — bare
  leaf, AND, OR, deeply nested — and is shared by live + backtest.
- **Open leaf types**: adding a new comparison (MACD, EMA cross,
  etc.) is a single switch case in the evaluator plus the type union.
  No DI rewiring, no migration, no controller plumbing.

## Out of scope (institutional-only concerns)

- Multi-asset capital allocation, portfolio risk constraints
- Execution algorithms (VWAP, TWAP, POV)
- Automated model retraining from post-trade analytics
- Weighted scoring / probabilistic rules (boolean composition first)
