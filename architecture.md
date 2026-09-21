# Architecture

BTC algotrading monorepo. Two surfaces (NestJS API + Next.js Web) backed by a
Postgres ledger, with all cross-process shapes driven by shared Zod schemas
generated from `packages/shared`.

This document is the ground-truth reference. If something here drifts from the
code, the code wins — open a PR to update this file alongside the change.

---

## Table of contents

1. [Monorepo & stack](#1-monorepo--stack)
2. [Top-level layout](#2-top-level-layout)
3. [Shared types — `@workspace/shared`](#3-shared-types--workspace-shared)
4. [API — `@workspace/api` (NestJS)](#4-api--workspace-api-nestjs)
   - 4.1 [Module graph](#41-module-graph)
   - 4.2 [Database (Prisma)](#42-database-prisma)
   - 4.3 [Validation pipeline (nestjs-zod)](#43-validation-pipeline-nestjs-zod)
   - 4.4 [Cross-cutting providers](#44-cross-cutting-providers)
     - 4.4.1 [`OrderExecution` (in-memory demo, router-ready)](#441-orderexecution-in-memory-demo-router-ready)
     - 4.4.2 [`MarketDataSource` (Binance polling + mock)](#442-marketdatasource-binance-polling--mock)
     - 4.4.3 [`DemoBalanceTracker`](#443-demobalancetracker)
     - 4.4.4 [`TradesService` (fill → ledger)](#444-tradesservice-fill--ledger)
5. [Automation engine](#5-automation-engine)
   - 5.1 [Three-layer model](#51-three-layer-model)
   - 5.2 [Providers (Strategy pattern)](#52-providers-strategy-pattern)
   - 5.3 [Rule engine (`ConditionEvaluator`)](#53-rule-engine-conditionevaluator)
   - 5.4 [Action executor](#54-action-executor)
   - 5.5 [Runner cron loop](#55-runner-cron-loop)
   - 5.6 [Run log + auto-pause (NCN-17)](#56-run-log--auto-pause-ncn17)
6. [Indicators + Market Data](#6-indicators--market-data)
7. [P&L pipeline](#7-pl-pipeline)
   - 7.1 [Trade ledger = source of truth](#71-trade-ledger--source-of-truth)
   - 7.2 [Realized P&L (`fifo.ts`)](#72-realized-pl-fifots)
   - 7.3 [Unrealized P&L (`unrealized.ts`)](#73-unrealized-pl-unrealizedts)
   - 7.4 [Bucketed time series (`bucket.ts`)](#74-bucketed-time-series-bucketts)
   - 7.5 [`PnlService` orchestrator + dashboard endpoint](#75-pnlservice-orchestrator--dashboard-endpoint)
8. [Web — `@workspace/web` (Next.js 16)](#8-web--workspace-web-nextjs-16)
   - 8.1 [App Router pages](#81-app-router-pages)
   - 8.2 [State + data layer](#82-state--data-layer)
   - 8.3 [Cross-page nav + active-account picker](#83-cross-page-nav--active-account-picker)
   - 8.4 [shadcn/ui (base-ui preset) + custom visuals](#84-shadcnui-base-ui-preset--custom-visuals)
9. [Cross-cutting concerns](#9-cross-cutting-concerns)
   - 9.1 [CORS, port, env](#91-cors-port-env)
   - 9.2 [DI tokens (Symbol) and test overrides](#92-di-tokens-symbol-and-test-overrides)
   - 9.3 [Long-only constraint + null discipline](#93-long-only-constraint--null-discipline)
   - 9.4 [Per-tick error handling](#94-per-tick-error-handling)
10. [Testing strategy](#10-testing-strategy)
11. [Migrations + ops](#11-migrations--ops)
12. [Where to start reading the code](#12-where-to-start-reading-the-code)

---

## 1. Monorepo & stack

- **Workspace manager:** pnpm 12.4.1 (workspaces in `pnpm-workspace.yaml` —
  `apps/*` + `packages/*`). `allowBuilds` whitelists the packages that need
  native post-install (esbuild, prisma engines, sharp, unrs-resolver).
- **Task runner:** Turborepo 2 (`turbo.json`). `build` depends on `^build`
  (deps first); outputs are `dist/**` (api, shared) and `.next/**` (web,
  excluding `.next/cache`). `dev` is non-cached + persistent. `lint` and
  `test` depend on `^build`.
- **TypeScript:** strict mode via `tsconfig.base.json` (`target: ES2023`,
  `module/moduleResolution: nodenext`, `isolatedModules`, `esModuleInterop`,
  `forceConsistentCasingInFileNames`). Each workspace extends.
- **Node:** ≥ 20.
- **Module type:** ESM (`"type": "module"` in `apps/api` and
  `packages/shared`); web handles its own mixed ESM/CJS via Next.

**Key versions:**

| Concern       | Version                          | Location                    |
| ------------- | -------------------------------- | --------------------------- |
| TypeScript    | 6.0.2 (api), 5.9.x (web/shared)  | `apps/api/package.json`     |
| Prisma        | 6.19.3                           | `apps/api/package.json`     |
| NestJS        | 12.0.x                           | `apps/api/package.json`     |
| React         | 19.2.8                           | `apps/web/package.json`     |
| Next.js       | 16.3.5                           | `apps/web/package.json`     |
| Zod           | 4.6.5                            | both                        |
| TanStack Query| 5.102.8                          | `apps/web/package.json`     |
| Vitest        | 4.1.x                            | `apps/api/package.json`     |
| Oxlint        | 1.58                             | `apps/api/package.json`     |
| ESLint (web)  | 9 (eslint-config-next 16.3.5)    | `apps/web/package.json`     |

> **Note on the TypeScript version skew:** the API pins TS 6 while the web
> and shared packages stay on TS 5. The shared package builds first (Turbo
> `dependsOn: ["^build"]`) so the API sees fresh `.d.ts`s before its own
> build, even with the version skew.

---

## 2. Top-level layout

```
.
├── apps/
│   ├── api/                     # NestJS service
│   │   ├── prisma/
│   │   │   ├── schema.prisma    # Single source of truth for DB
│   │   │   └── migrations/      # Append-only SQL files; applies on `db:migrate`
│   │   ├── src/                 # TS source; entrypoint: src/main.ts
│   │   ├── test/                # Vitest config + e2e config
│   │   ├── tsconfig.json
│   │   └── nest-cli.json
│   └── web/                     # Next.js 16 (App Router)
│       └── src/
│           ├── app/             # App Router: layout.tsx, providers.tsx, page routes
│           ├── components/      # UI components (account-selector, automation/, ui/)
│           ├── hooks/           # TanStack Query hooks (use-*.ts)
│           └── lib/             # HTTP client + view-state types (api.ts)
├── packages/
│   └── shared/                  # Zod schemas + inferred types (built via tsc)
│       └── src/
│           ├── schemas/         # One file per domain (trade.ts, pnl.ts, …)
│           ├── enums/           # Frozen enum constants mirror the schema unions
│           └── index.ts         # Re-export hub for types + runtime schemas
├── docker-compose.yml           # postgres:15 on host port 5433
├── turbo.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json                 # Root scripts: dev, build, lint, test, db:*
```

---

## 3. Shared types — `@workspace/shared`

Builds with `tsc -p tsconfig.json` to `dist/`, exports `dist/index.d.ts` +
`dist/index.js`. Both `@workspace/api` and `@workspace/web` import from this
single entry point.

**Three layers per domain shape:**

1. **`schemas/<domain>.ts`** — Zod schema (source of truth at runtime).
   `export const XSchema = z.object({...});` `export type X = z.infer<typeof XSchema>;`
2. **`enums/<domain>.ts`** — Frozen arrays like `export const AUTOMATION_STATUSES =
   ['enabled', 'disabled', 'paused'] as const;` mirroring the schema's string
   unions. Both `as const`-typed literal exports and TS string literal-type
   siblings exist so client code can iterate OR type-narrow.
3. **`index.ts`** — Central re-export. Types inferred from schemas are
   re-exported via `export type {…}`. The runtime Zod schemas themselves are
   re-exported as values via `export {…} from './schemas/index.js'` so callers
   can pass them to `nestjs-zod`'s `createZodDto(Schema)` or to a client-side
   validator.

**Concrete domains covered:**

| Schema                       | Notable shapes                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `schemas/domain.ts`          | `Candle`, `CandleWithIndicators`, `PriceTick`, `Unsubscribe`, `EvalContext`, `NormalizedSignal`, `Position`, `EvaluationDegree/Phase/Direction` |
| `enums/*.ts`                 | `AccountStatus`, `AccountType`, `OrderStatus`, `AutomationItemStatus`, `Signal`, `Timeframe`, `TradeSide`, `AUTOMATION_STATUSES` |
| `schemas/order.ts`           | `OrderSchema`, `PlaceOrderInputSchema`, `OrderEventSchema`                     |
| `schemas/trade.ts`           | `TradeSchema`, `TradeHistoryRowSchema`, `TradeHistoryPageSchema`, `TradeListFiltersSchema`, plus `TRADE_HISTORY_DEFAULT_LIMIT/MAX_LIMIT` constants |
| `schemas/automation.ts`      | `AutomationInputSchema` (discriminated union by `input.kind`), `ConditionSource/Leaf/Composite/NodeSchema`, `AutomationActionSchema`, `AutomationOutputSchema`, `AutomationItemSchema`, `Create/UpdateAutomationInputSchema`, `AutomationRunSchema`, `RunOutcomeSchema`, plus `RUN_LOG_DEFAULT_LIMIT/MAX_LIMIT` constants |
| `schemas/pnl.ts`             | `ClosedLotMatchSchema`, `RealizedPnlMatchSchema`, `RealizedPnlSummarySchema`, `UnrealizedPositionSchema`, `UnrealizedPnlSummarySchema`, `PnlBucketSchema` ('day'\|'week'\|'month'), `PnlBucketPointSchema`, `AccountDashboardSchema` |
| `enums/*.ts`                 | All status / timeframe / signal enums mirrored from string unions |

> **Why two layers (schemas + enums)?** Zod schemas own the wire shape; the
> frozen enums let UI code iterate (`AUTOMATION_STATUSES.map(...)`) without
> duplicating literals.

---

## 4. API — `@workspace/api` (NestJS)

NestJS 12 (Common, Config, Schedule), structured along one feature-module per
top-level concern. Bootstrap is in `src/main.ts`:

```ts
const app = await NestFactory.create(AppModule);
app.useGlobalPipes(new ZodValidationPipe());   // Zod-only; no class-validator
app.enableCors({ origin: corsOrigins.length > 0 ? corsOrigins : true });
await app.listen(Number(process.env.PORT ?? 3001));
```

`setDefaultResultOrder('ipv4first')` is set at module load so Nest's DNS
lookups behave consistently under dual-stack.

### 4.1 Module graph

App-level wiring lives in `src/app.module.ts`. Imports follow the actual
dependency direction (bottom-of-stack first), so each row knows only its
direct providers:

```
ConfigModule.forRoot({ isGlobal: true })
ScheduleModule.forRoot()              ← @nestjs/schedule (cron decorators)
PrismaModule                         (@Global) PrismaService — PrismaClient + OnModuleDestroy
BinanceModule                        ← BinanceService — wraps Binance REST (klines, price)
IndicatorsModule                     ← IndicatorsService — RSI/EMA/WMA + SR/wave pure fns
  ↑ SignalsModule (klines + indicators)
PricesModule                         ← thin wrapper over Binance klines for /prices HTTP
PriceSyncModule                      ← @Cron: persist Binance klines → Candle table (opt-in)
PositionsModule                      ← /position-boxes CRUD (NCN-7 chart annotations; not trading positions)
SettingsModule                       ← key/value JSON store
MarketDataModule                     ← BinanceMarketDataSource bound to MARKET_DATA_SOURCE token
AccountsModule                       ← AccountsService + DemoBalanceTracker + /accounts HTTP
  ├── OrderExecutionModule (MockOrderExecution bound to ORDER_EXECUTION token)
  └── PnlModule                       (Realized + Unrealized + Bucketed dashboard endpoint)
AutomationModule                     ← AutomationRunner @Cron + ConditionEvaluator + ProviderRegistry
  ├── OrderExecutionModule
  └── MarketDataModule
  └── providers: TimeProvider, SRProvider, WaveProvider
TradesModule                         ← subscribes to demo fills → Trade ledger; serves /trades
PnlModule                            ← /pnl endpoints
```

Each module re-exports its public services (`exports:`) when other modules
need them.

### 4.2 Database (Prisma)

`apps/api/prisma/schema.prisma` is the single source of truth. `DATABASE_URL`
from `.env` (default `postgresql://trading:trading@localhost:5433/trading`).
Migrations live as timestamped SQL files under
`apps/api/prisma/migrations/`; they apply via `pnpm db:migrate`.

```
Candle              (symbol, interval, openTime)   — kline cache
SignalEvaluation    (symbol, interval, signal)     — historical signal log
PositionBox         (symbol, interval, side)       — chart annotation (NCN-7)
Setting             (key, value JSON)              — app settings KV
Account             (type: real|demo, status, balance)
Trade               (accountId, symbol, side, price, qty, fee?, timestamp, automationItemId?)
  ── @@index(accountId, timestamp desc) @@index(symbol, timestamp desc)
Position            (UNIQUE(accountId, symbol))    — declared but currently unused at runtime
AutomationItem      (accountId, config JSON columns, status, consecutiveErrors)
  ── config columns: input/condition/action/output JSON, validated at the API edge
AutomationRun       (automationItemId, outcome, message?, ranAt: BigInt ms)
  ── @@index(automationItemId, ranAt)
SRLine              (symbol, interval, kind, price)
```

`String` columns are used for enums (`type`, `side`, `status`, `signal`,
`kind`, `interval`) rather than Postgres native enums — cross-process
contracts are Zod-driven, the column is just a label. JSON columns hold
the automation configs (validated at the API layer with `nestjs-zod`).

**Cascades & constraint design notes:**

- `Trade.automationItemId` → `AutomationItem.id` with **`onDelete: SetNull`**
  so the append-only ledger survives item deletion.
- `AutomationItem.accountId` → `Account.id` with **`Cascade`** (demo-account
  deletion tears down its rules).
- `AutomationRun.automationItemId` → `AutomationItem.id` with **`Cascade`**
  (runs are bound to the item's lifetime).
- `Trade.accountId` → `Account.id` with `RESTRICT` so the historical ledger
  isn't lost accidentally when an account is deleted (demo accounts are
  expected to be archived, not deleted).

### 4.3 Validation pipeline (nestjs-zod)

`ZodValidationPipe` is registered globally in `main.ts`. Every controller
body / query / param that wants validation declares `@Body(SomeDto)` /
`@Query(SomeDto)` where `SomeDto extends createZodDto(SomeSchema)`. The
schema is read off the DTO via reflection, so the API and the client agree
on wire shape — the schema is the only definition.

**Example (automation controller):**

```ts
import { createZodDto } from 'nestjs-zod';
import { CreateAutomationInputSchema } from '@workspace/shared';

class CreateAutomationDto extends createZodDto(CreateAutomationInputSchema) {}

@Post()
create(@Body() body: CreateAutomationDto) { return this.automation.create(body); }
```

The standard Nest `ValidationPipe` (class-validator) is intentionally NOT
used — Zod owns validation end-to-end.

### 4.4 Cross-cutting providers

#### 4.4.1 `OrderExecution` (in-memory demo, router-ready)

Defined in `src/order-execution/order-execution.types.ts`:

```ts
export abstract class OrderExecution {
  abstract readonly accountType: AccountType;          // 'demo' (today), 'real' (future)
  abstract placeOrder(input: PlaceOrderInput): Promise<Order>;
  abstract cancelOrder(accountId, orderId): Promise<Order>;
  abstract getOrderStatus(accountId, orderId): Promise<Order>;
  abstract subscribe({ accountId }, onEvent): Unsubscribe;
}
export const ORDER_EXECUTION = Symbol('OrderExecution');
```

`OrderExecutionModule` binds `MockOrderExecution` (`src/order-execution/mock-order-execution.ts`)
as the DI implementation. It maintains:

- A per-account order book (for `cancelOrder` / `getOrderStatus` lookups).
- Per-symbol mock fill prices seeded via `setFillPrice()` (tests; real impls
  quote the broker).
- Per-account subscriber fan-out. Subscribers (e.g. `DemoBalanceTracker`,
  `TradesService`) receive every state transition for orders they own —
  no other accounts' events.

`MockOrderExecution.placeOrder` returns `status: FILLED` synchronously for
instant fills; `placePendingOrder` (test-only) returns `PENDING` for exercising
cancel/reject paths. The placeholder for the real broker (`NCN-10`) is a
router that dispatches on `accountType`.

#### 4.4.2 `MarketDataSource` (Binance polling + mock)

Defined in `src/market-data/market-data.types.ts`:

```ts
export abstract class MarketDataSource {
  abstract getCandles(input): Promise<Candle[]>;     // ascending by openTime
  abstract subscribe({ symbol }, onTick): Unsubscribe;
  abstract getLatestPrice({ symbol }): Promise<number | null>;
  abstract shutdown(): void;
}
export const MARKET_DATA_SOURCE = Symbol('MarketDataSource');
```

Two concrete impls:

- **`BinanceMarketDataSource` (production).** Historical candles delegate to
  `BinanceService.getKlines`. Real-time ticks are produced by a 1-second
  polling `setInterval` per symbol — one polling timer shared across all
  subscribers of that symbol (Set-of-callbacks). On broker failure during
  `getLatestPrice`, returns the last cached value (or `null` if nothing has
  been observed). Cleared on module destroy.
- **`MockMarketDataSource` (tests).** Scriptable via `setCandles()`,
  `setLatestPrice()`, `emitTick()`, `emitCandles()`. Same shutdown semantics.

`MarketDataModule` binds the Binance source as the default `MARKET_DATA_SOURCE`;
tests override by re-binding in `TestingModule`.

#### 4.4.3 `DemoBalanceTracker`

`src/accounts/demo-balance.tracker.ts` — subscribes to every demo account's
`OrderExecution` event stream. On `filled`, it mutates `Account.balance`
in-place: `BUY −= price × qty`, `SELL += price × qty` (paper money; no
overdraft protection — by design, so strategies can be tested without
pre-fund checks).

Lifecycle:

- `OnModuleInit` → subscribes to every existing demo account.
- `AccountsService` → calls `track(accountId)` / `untrack(accountId)` on
  account create/disable.

#### 4.4.4 `TradesService` (fill → ledger)

`src/trades/trades.service.ts` — on `OnModuleInit` it polls every demo account
and subscribes to its `OrderExecution` events. On `filled`, a `Trade` row is
inserted with `automationItemId = order.automationItemId` (or `null` for
manual). On a `5s` set-interval, new demo accounts are picked up (accounts
are rare — no need for an event bus yet).

Also serves the trade-history HTTP: a filterable + paginated list (`/trades/page`)
with per-row `realizedPnl` derived by re-running the FIFO matcher once per
account in the page (see §7.2).

---

## 5. Automation engine

This is the load-bearing domain. The architecture is documented in detail in
`apps/api/src/automation/README.md` and intentionally reuses the Strategy
pattern for inputs and a recursive `ConditionNode` tree for rules so new
behaviors land without rewriting the engine.

### 5.1 Three-layer model

```
PROVIDER           ── produces raw signals (independent modules,
                      no shared state across providers)
       ↓ normalize
NORMALIZED SIGNAL  ── { direction, phase, degree, timeRange, source }
                      — the shape every leaf in the rule tree matches
                      against, regardless of provider source
       ↓ evaluate()
RULE ENGINE        ── walks ConditionNode trees against EvalContext
                      leaves: rsi_above / rsi_below / wave_direction /
                              wave_contained_in / wave_phase_not (+ legacy_pass)
                      composites: AND / OR, recursive
```

Same `evaluate()` for live automation AND backtest — backtest just replays
historical candles through providers into the same `EvalContext` shape.

### 5.2 Providers (Strategy pattern)

Defined in `src/automation/providers/provider.abstract.ts`:

```ts
export abstract class Provider<TConfig, TRawSignal> {
  abstract readonly kind: string;                                // matches AutomationInput.kind
  abstract validateConfig(raw: unknown): TConfig;
  abstract evaluate(ctx): Promise<TRawSignal | null>;
  abstract normalize(raw, ctx): NormalizedSignal | NormalizedSignal[];  // array OK for multi-zone sources
}
```

`ProviderRegistry` (a simple Map) is the DI hub. Providers self-register in
their constructors via `registry.register(this)`. Adding a new provider =
add the class to `automation.module.ts`'s `providers:` list.

**Currently registered:**

| Provider                  | `kind`                  | Source                              |
| ------------------------- | ----------------------- | ----------------------------------- |
| `TimeProvider`            | `time`                  | Croner (`@S+S+S+S+S`)               |
| `SupportResistanceProvider` | `supportResistance` | Pivot-and-cluster over 1h candles   |
| `RsiEmaWaveProvider`      | (typed access only; see `apps/api/src/automation/providers/wave.provider.ts`) | RSI/EMA crossover detector over OHLCV |

Inputs are validated at the API edge by the same `AutomationInputSchema` Zod
discriminated union consumed via `nestjs-zod`; `validateConfig` re-validates
at runtime against the provider's specific config shape, throwing
`BadRequestException` for malformed payloads.

`normalize()` returns either a single `NormalizedSignal` or an array — the
multi-signal form is used by `SupportResistanceProvider` (one signal per
detected S/R level). The runner flattens both shapes into
`EvalContext.signals`.

### 5.3 Rule engine (`ConditionEvaluator`)

`src/automation/rule-engine/condition.evaluator.ts` — single generic
`evaluate(node, ctx): boolean` that walks any shape:

- **Leaf nodes** (`LeafCondition`): `rsi_above`, `rsi_below`, `wave_direction`,
  `wave_contained_in`, `wave_phase_not`.
- **Composite nodes** (`CompositeCondition`): `{ operator: 'and' | 'or', children: ConditionNode[] }` — recursive.
- A bare leaf is a valid tree; AND/OR is only needed when composing checks.

RSI leaves read from `EvalContext.indicators[...]` keyed by
`${providerKind}:${timeframe}:${symbol}` (helper in `@workspace/shared`:
`indicatorKey(source)`).

The exhaustiveness guard on the discriminator switch will fail to compile
when a new leaf variant is added — that's the contract for adding leaves.

### 5.4 Action executor

`src/automation/action-executor.ts` — translates a validated `AutomationAction`
into an `Order`, calls `OrderExecution.placeOrder`, and returns a discriminated
result:

```ts
type ActionExecutionResult =
  | { kind: 'placed'; order: Order }
  | { kind: 'no-order'; reason: string };  // e.g. unknown side
```

`toPlaceOrderInput(action): PlaceOrderInput` is a pure helper, easy to unit-test
without DI. Threading `automationItemId` into the placement context is what
lets the Trade ledger attribute the resulting fill back to its rule.

### 5.5 Runner cron loop

`src/automation/automation.runner.ts` — `@Injectable()` decorated with
`@Cron('* * * * *')`. Tests drive the loop via `runOnce(now)` directly.

`runOnce(now)` flow:

```
1. const items = prisma.automationItem.findMany({ where: { status: 'enabled' } })
2. for each item:
     try:
       result = runItem(item, now)   ── returns { outcome, message }
       recordOutcome(item.id, outcome, message, now)  ── writes AutomationRun,
                                                       ── inc/reset consecutiveErrors,
                                                       ── auto-pause if ≥ 3
     catch err:
       recordOutcome(item.id, 'error', err.message, now).catch(...)   ── swallowing the recorder
```

`runItem` itself is the per-item pipeline:

```
a. provider.validateConfig(item.input)            ── throws if config broke after creation
b. provider.evaluate({...ctx, config}) → raw
c. normalize() → NormalizedSignal[]              ── built into EvalContext.signals
d. ConditionEvaluator.evaluate(item.condition, ctx)
e. if holds: actionExecutor.execute({ accountId, automationItemId }, item.action)
```

The runner ignores `disabled`/`paused` items at the `findMany` filter so
auto-paused items stop receiving tick cycles immediately.

### 5.6 Run log + auto-pause (NCN-17)

Per-tick persistence:

- **One `AutomationRun` row** per item per tick, written **after** the
  outcome is known. `{ id, automationItemId, outcome: 'fired'|'skipped'|'error',
  message?, ranAt: BigInt ms }` with `@@index([automationItemId, ranAt])` for
  the recent-runs query.
- **Per-item `consecutiveErrors: Int @default(0)`**. Atomic increment via
  Prisma's `{ increment: 1 }` update (returns the post-increment value);
  reset to `0` via `updateMany` on any non-error tick.
- **Auto-pause threshold = 3 consecutive errors.** Once crossed, the runner
  issues a second `update({ data: { status: 'paused' } })` so the next
  tick's `findMany({ status: 'enabled' })` skips the item.

The outer `try/catch` in `runOnce` swallows `recordOutcome` failures too —
losing a log row should never take the runner down.

HTTP exposure:

- `GET /automation/:id/runs?limit=N` (default 20, max 100) — newest-first
  cursor-free list, useful for the (forthcoming) recent-runs panel in the
  UI.

---

## 6. Indicators + Market Data

`src/indicators/` exposes the user-facing indicator HTTP (`/indicators`) and
the pure technical-analysis functions used by the SR / wave providers:

- **`trading-signals`** package (`RSI`, `EMA`, `WMA` with period overrides).
  All return `(number | null)[]` aligned to the input array (`null` until
  enough data is accumulated — same convention the leaves rely on).
- **`sr-detector.ts`** — pure pivot-and-cluster S/R zone detector. Strict
  `>=` / `<=` pivot comparison (a flat interior candle does not qualify
  even if its neighbors happen to be lower).
- **`wave-detector.ts`** — pure RSI/EMA crossover detector that emits
  `WaveSegment`s with magnitude (`peakRsi − troughRsi`) for downstream
  filtering.

`BinanceService` (`src/binance/binance.service.ts`) is the only network
component for historical candles. It supports the `Timeframe` union
(1m/5m/15m/1h/4h/1d plus multi-day 2d/3d/4d/5d/6d/1w aggregated from 1d
buckets — Binance doesn't natively support those).

`PriceSyncService` (@Cron every minute, opt-in via `PRICE_SYNC_ENABLED=true`)
persists the latest N Binance klines to the `Candle` table — used by the
candle chart on the home page so it doesn't have to re-poll Binance on every
page load.

---

## 7. P&L pipeline

Three pure functions + one orchestrating service. Same pattern everywhere:
the trade ledger is the source of truth, derived views are computed on
demand, no separate persistence for derived state.

### 7.1 Trade ledger = source of truth

`Trade` rows are append-only. Schema per row (see §4.2):

- `fee` nullable — legacy rows + broker integrations that don't break out
  fees both compute PnL as if `fee = 0`.
- `automationItemId` nullable with `onDelete: SetNull` — deleting an item
  preserves historical fills.

### 7.2 Realized P&L (`fifo.ts`)

`src/pnl/fifo.ts`:

- Input: chronologically-sorted trades (asc by `(timestamp, id)` — caller
  guarantees order).
- Output: `RealizedPnlMatch[]` — one per sell that consumed ≥ 1 unit.
- Long-only. A sell that exceeds the open long position is clamped at the
  available quantity and a `warn(msg)` is emitted via the optional
  `FifoLogger`.
- Fees: `costPerUnit = price + fee/buyQty` for buys;
  `proceedsPerUnit = price − fee/sellQty` for sells. Matched buys keep
  each consumed lot's `costPerUnit` so the API can show per-lot basis.

Re-runnable. Deterministic. Used by `PnlService.getSummary/listMatches`,
`TradesService.listPage` (per-row PnL attachment), and `PnlService.getPnlSeries`.

### 7.3 Unrealized P&L (`unrealized.ts`)

`src/pnl/unrealized.ts`:

- Input: trades (same shape).
- Output: `UnrealizedPosition[]` — volume-weighted average entry price per
  held symbol plus the timestamp of the oldest still-contributing lot.
- `openedAt` rolls forward when the front lot is fully consumed.
- Sorted alphabetically by symbol for stable responses.

### 7.4 Bucketed time series (`bucket.ts`)

`src/pnl/bucket.ts`:

- Input: `RealizedPnlMatch[]` + `PnlBucket` ('day' | 'week' | 'month').
- Output: `PnlBucketPoint[]` — sparse (only buckets with ≥ 1 match).
- Day = UTC calendar day.
- Week = ISO week (Monday-anchored).
- Month = `YYYY-MM-01`.
- Defensive: bad ISO timestamps are skipped (silently — the FIFO matcher
  emits well-formed timestamps).

### 7.5 `PnlService` orchestrator + dashboard endpoint

`src/pnl/pnl.service.ts` injects `PrismaService` and `MARKET_DATA_SOURCE`,
and exposes:

- `getSummary(accountId)` → `RealizedPnlSummary` (FIFO totals + per-symbol + matches).
- `listMatches(accountId)` → `RealizedPnlMatch[]` (audit trail).
- `getUnrealizedPositions(accountId)` → `UnrealizedPosition[]` (open positions; mark-to-market against `MarketDataSource.getLatestPrice` per symbol in parallel via `Promise.all`).
- `getUnrealizedSummary(accountId)` → `UnrealizedPnlSummary` (aggregated, skips null-mark positions from totals).
- `getPnlSeries(accountId, bucket)` → `PnlBucketPoint[]` (the dashboard chart series).

Controllers expose matching HTTP:

- `/pnl/realized`, `/pnl/realized/trades`, `/pnl/unrealized`, `/pnl/unrealized/positions` (PnlController).
- `/accounts/:id/dashboard?bucket=day|week|month` (AccountsController — composes the four calls in `Promise.all`, computes `equity = balance + totalUnrealizedPnl`).

**Null discipline:** when the market source returns `null` for a symbol (no
quote yet, broker 404, etc.) the position row has `markPrice: null`,
`unrealizedPnl: null`, `pricedAt: null`. The aggregate `totalUnrealizedPnl`
skips null-mark rows — never zeroing out a position that just lacks a tick.

---

## 8. Web — `@workspace/web` (Next.js 16)

Next.js App Router (single-file routes in `src/app/`), React 19.2.8,
TypeScript 5, Tailwind v4, `lightweight-charts` for the candle chart,
`@base-ui/react` (the preset shadcn uses — `<Select>`, `<Dialog>`, `<Input>`,
`<Card>` etc. are all base-ui primitives wrapped in `apps/web/src/components/ui/`).

### 8.1 App Router pages

| Route                  | Component                | What it does                                                                 |
| ---------------------- | ------------------------ | ---------------------------------------------------------------------------- |
| `/`                    | `app/page.tsx`           | BTC candle chart + signals + cross-page header links                        |
| `/accounts`            | `app/accounts/page.tsx`  | Create / list / disable accounts                                              |
| `/automation`          | `app/automation/page.tsx`| Automation rules per active account (list + create / edit / delete dialog)  |
| `/dashboard`           | `app/dashboard/page.tsx` | Account dashboard: 4 KPI cards + bucketed PnL series visualization          |
| `/trades`              | `app/trades/page.tsx`    | Filterable + paginated trade history table                                   |
| `layout.tsx`           | —                        | Inter + JetBrains Mono fonts, dark mode via `.dark` class                   |
| `providers.tsx`        | —                        | `QueryClientProvider` (TanStack Query 5, 10s staleTime, refetchOnFocus)     |

### 8.2 State + data layer

- **Server-state:** TanStack React Query, one `useQuery` per data shape.
  Hooks live in `apps/web/src/hooks/use-*.ts` and own their own fetchers —
  the fetch + the consumer are in the same file.
- **Auth/account context:** `useActiveAccountId()` (NCN-11) reads /
  writes `localStorage[activeAccountId]`. Returns `null` while the client
  hasn't hydrated so SSR-rendered pages render a placeholder first.
- **HTTP client:** `apps/web/src/lib/api.ts` provides `apiGet / apiPost /
  apiPatch / apiPut / apiDelete`, an `ApiError` class with a typed
  `status`, and the `API_URL` constant (`NEXT_PUBLIC_API_URL` defaulting
  to `http://localhost:3001`).
- **Shared types:** All HTTP shapes flow from `@workspace/shared`. The same
  Zod schemas the API validates against are re-exported on the client so
  client code can run `TradeHistoryRowSchema.parse(row)` if it wants to
  (used in form dialogs to fail-fast on malformed selections).

### 8.3 Cross-page nav + active-account picker

Every page renders a header with cross-page links to the others and embeds
the shared `AccountSelector` component (`apps/web/src/components/account-selector.tsx`).
Active selection is global via `useActiveAccountId`. Pages that consume the
selection mirror the chosen id once on hydration (computed during render —
not in an effect — to satisfy React 19's `set-state-in-effect` lint rule).

### 8.4 shadcn/ui (base-ui preset) + custom visuals

UI primitives live in `apps/web/src/components/ui/`: `Button`, `Input`,
`Card`, `Dialog`, `Badge`, `AlertDialog`, `Select` (a thin wrapper over
`@base-ui/react`'s select). All use the same shadow / radius variables
defined in `app/globals.css`.

**Custom visuals rather than chart dep:** The dashboard PnL series is
rendered as a centered-axis CSS bar visualization (50% width per side,
green for gains / red for losses, sparse-friendly empty state). The chart
needed is one — pulling in Recharts (heavy) is overkill. The candle chart
on the home page uses `lightweight-charts`.

---

## 9. Cross-cutting concerns

### 9.1 CORS, port, env

- API on port `3001` (overridable via `PORT`).
- API CORS: comma-separated `CORS_ORIGIN` env var; if absent, all origins
  (`true`).
- Web API URL: `NEXT_PUBLIC_API_URL`, default `http://localhost:3001`.
- DB: `DATABASE_URL`, default `postgresql://trading:trading@localhost:5433/trading`.
- `PRICE_SYNC_ENABLED=true` + `PRICE_SYNC_SYMBOL` + `PRICE_SYNC_INTERVAL`
  opt-in for the candle persistence cron.
- `BINANCE_BASE_URL` defaults to `https://api.binance.com` (override for
  test fixtures).

### 9.2 DI tokens (Symbol) and test overrides

Two interface types ship with DI tokens so the same interface can be bound
to one impl in production and another in tests:

```ts
export const MARKET_DATA_SOURCE = Symbol('MarketDataSource');
export const ORDER_EXECUTION      = Symbol('OrderExecution');
```

Test modules override by passing `TestingModuleBuilder.overrideProvider(...)`
or by declaring an alternate binding via `useExisting: SomeTestImpl`. See
`apps/api/src/market-data/market-data.module.ts` and
`apps/api/src/order-execution/order-execution.module.ts` for the default
binding shape.

### 9.3 Long-only constraint + null discipline

- **Long-only**: PnL pipeline + `MockOrderExecution` are long-only. Shorts
  are out of scope for the demo flow. The tracker's "no overdraft" is
  intentional paper-money semantics.
- **Null vs. zero**: Matches with no `buyTradeId` (sells with no open
  position) emit no row. Positions with no mark emit `null` rather than
  `0` — aggregates skip nulls. The UI distinguishes "I don't have a price"
  from "the price gave me zero".

### 9.4 Per-tick error handling

The runner's outer `try/catch` covers both `runItem` and `recordOutcome`.
If the recorder itself throws, the error is logged and swallowed — losing
a log row should never take down the runner. `findMany({ status: 'enabled' })`
filters out auto-paused items so the next tick leaves them alone.

The opposite scenario — `findUnique` for a deleted account or Trade — is
handled by the consumer (dashboard returns 404 on missing account; trades
list returns `[]` when `accountId` is missing).

---

## 10. Testing strategy

Vitest 4 with mock Prisma clients per test file. Coverage is best on:

- **Pure functions** (`fifo.ts`, `unrealized.ts`, `bucket.ts`, `sr-detector.ts`,
  `wave-detector.ts`, `condition.evaluator.ts`) — easy to test directly.
- **Services** with mocked Prisma (`AccountsService`, `PnlService`,
  `TradesService`, `AutomationService`, `AutomationRunner`) — mocks expose
  exactly the `prisma.X.findMany/update/...` surface the service uses; the
  service's own call sites are exercised, no DI required.

Notable test conventions:

- `makePrismaMock(...)` helpers are local to the spec file. Each project's
  data shape mirrors what Prisma would return for the tested methods.
- For `OrderExecution`-driven services (`TradesService`, `DemoBalanceTracker`),
  the mock implements `OrderExecution` directly with extras like
  `setFillPrice()` and `subscriberCount()`.
- For `MarketDataSource`, the same — `MockMarketDataSource` is exported
  from `src/market-data/mock-market-data.source.ts` and is scriptable
  (`setLatestPrice`, `emitTick`).
- Apparent timings on the runner (`AUTO_PAUSE_THRESHOLD = 3`) are exercised
  through `@Cron` is bypassed — tests call `runOnce(now)` directly with
  deterministic fixed `now`.

Tests skipped intentionally: web app pages. The web layer is verified by
end-to-end smoke against the live API rather than jsdom-style component
tests.

---

## 11. Migrations + ops

- `pnpm db:up` — bring up Postgres via Docker Compose.
- `pnpm db:migrate` — apply migrations against `DATABASE_URL`.
- `pnpm db:generate` — regenerate Prisma client after schema edits.
- `pnpm db:studio` — open Prisma Studio.
- Migration files are timestamped SQL: `YYYYMMDDhhmmss_<slug>/migration.sql`.
  The full list lives under `apps/api/prisma/migrations/`; the most recent
  one at the time of writing is `20260919091343_ncn17_runlog_and_consecutive_errors`.
- `apps/api/.env` carries the dev-time `DATABASE_URL`. The schema targets
  Postgres only (the `provider` is `postgresql`).
- The root `package.json` has a `postinstall` hook that calls
  `prisma generate` inside `@workspace/api` so fresh clones have a usable
  Prisma client immediately.

---

## 12. Where to start reading the code

A high-leverage tour path for a new contributor:

1. **`packages/shared/src/index.ts`** + `schemas/*.ts` — every cross-process
   shape is here. Start here to understand the contract surfaces.
2. **`apps/api/prisma/schema.prisma`** — the database table layout.
3. **`apps/api/src/app.module.ts`** — the module graph.
4. **`apps/api/src/automation/README.md`** + `automation/automation.runner.ts`
   — the runtime loop and plugin architecture.
5. **`apps/api/src/pnl/fifo.ts`** + `unrealized.ts` + `bucket.ts` — three
   pure functions, together the entire P&L pipeline in ~250 lines of
   code. Open to confirm anything about realized / unrealized / bucketed math.
6. **`apps/api/src/order-execution/order-execution.types.ts`** + `mock-order-execution.ts` —
   the boundary every fill, order, and event cross.
7. **`apps/api/src/market-data/binance-market-data.source.ts`** — single
   concrete implementation of the `MarketDataSource` interface; reveals the
   "polling a single timer per symbol, fan-out to all subscribers" pattern.
8. **`apps/web/src/app/layout.tsx`** + `providers.tsx` — web entry point.
9. **`apps/web/src/hooks/use-active-account.ts`** — the cross-cutting
   global state primitive; small file, big ramifications.
10. **`apps/web/src/app/dashboard/page.tsx`** — the most "shapes from many
    endpoints" page; open this to see how a hook-of-hooks composition
    reads.
