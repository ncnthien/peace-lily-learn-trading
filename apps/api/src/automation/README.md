# Automation

Three-layer architecture for the Automation engine (NCN-12):

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
                                ↓ predicates
┌──────────────────────────────────────────────────────────────────────┐
│ CONFLUENCE  — boolean AND/OR over predicates matched against signals│
│   covers peer comparison (same degree) AND containment (diff degree) │
└──────────────────────────────────────────────────────────────────────┘
```

## Layout

```
automation/
├── providers/
│   ├── provider.abstract.ts        # Strategy interface
│   ├── provider.registry.ts        # kind → Provider map
│   └── time.provider.ts            # Reference implementation (cron)
├── confluence/
│   └── confluence.evaluator.ts    # AND/OR over predicates
├── automation.module.ts
├── automation.service.ts           # CRUD on AutomationItem
└── automation.controller.ts        # HTTP
```

## Adding a new Provider

The plugin pattern is the core of this architecture. Adding a new input
source (e.g. ZigZag wave detection, Support/Resistance touch, MACD
crossover) does NOT require touching the engine, the registry, or the
confluence layer. You only need to:

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

## Why this shape

- **Plugin-style** (Strategy pattern): new providers don't change the
  engine.
- **Normalized output** (Normalizer layer): the Confluence layer
  compares signals without knowing where they came from. Peer comparison
  (same degree, different source) and containment (different degree)
  fall out naturally from `signal.degree` + `signal.direction` matching.
- **Boolean composition first** (not weighted scoring): enough to
  validate which combinations actually work before investing in
  scoring complexity. Out of scope per NCN-12: portfolio/risk layers,
  execution algos, automated retraining loops.

## Out of scope (institutional-only concerns)

- Multi-asset capital allocation, portfolio risk constraints
- Execution algorithms (VWAP, TWAP, POV)
- Automated model retraining from post-trade analytics
