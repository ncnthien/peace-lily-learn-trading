# peace-lily-learn-trading

BTC price tracking, technical indicators (RSI, EMA crossover) and buy/sell signals.

## Stack

| Layer    | Tech                                              |
| -------- | ------------------------------------------------- |
| Web      | Next.js 16 (App Router, TypeScript, Tailwind CSS) |
| API      | NestJS 12 (TypeScript, ESM)                       |
| Database | PostgreSQL 16 + Prisma 6                        |
| Data     | Binance public REST API                           |
| Tooling  | pnpm workspaces + Turborepo                       |

## Structure

```
apps/
  web/            Next.js dashboard (chart + signals)
  api/            NestJS API (Binance, indicators, signals, Prisma)
packages/
  shared/         Shared TypeScript types (Candle, Signal, Timeframe, ...)
```

## Getting started

Prerequisites: Node 20+, pnpm, Docker (for Postgres).

```bash
pnpm install          # install all workspace dependencies

pnpm db:up            # start Postgres via docker compose
pnpm db:migrate       # apply Prisma migrations (creates initial migration)

pnpm dev              # start API (:3001) + web (:3000) via Turborepo
```

Open http://localhost:3000 — the API serves http://localhost:3001.

Without Docker the API and chart still work (Binance data needs no DB); only
candle persistence and Prisma queries require Postgres.

## Useful scripts

| Command                 | Description                          |
| ----------------------- | ------------------------------------ |
| `pnpm dev`              | Dev servers (api + web) with watch   |
| `pnpm build`            | Build all packages                   |
| `pnpm lint`             | Lint all packages                    |
| `pnpm test`             | Run tests                            |
| `pnpm db:up` / `db:down`| Start/stop Postgres                  |
| `pnpm db:migrate`       | Create/apply Prisma migration        |
| `pnpm db:studio`        | Open Prisma Studio                   |

## API endpoints

| Endpoint                                  | Description                            |
| ----------------------------------------- | -------------------------------------- |
| `GET /health`                             | Health check                           |
| `GET /prices/klines?symbol=BTCUSDT&interval=1h&limit=200&startTime=<ms>&endTime=<ms>` | OHLCV candles from Binance. Intervals: `1m 5m 15m 1h 4h 1d 2d 3d 4d 5d 6d 1w` (multi-day ones not native to Binance are aggregated from daily candles). History back to 2017; `endTime` alone returns the candles just before it — use it to page backwards |
| `GET /prices/ticker?symbol=BTCUSDT`       | Latest price                           |
| `GET /indicators/candles?symbol=BTCUSDT&interval=1h&limit=200&startTime=<ms>&endTime=<ms>` | Candles enriched per-candle with `rsi` (14), `emaRsi` (EMA 9 of RSI), `wmaRsi` (WMA 45 of RSI) — `null` during warm-up |
| `GET /indicators/levels?symbol=BTCUSDT&interval=1h` | Auto-detected support/resistance levels (pivot clustering, top 6 by touches) |
| `GET /signals/latest?symbol=BTCUSDT&interval=1h` | Indicator evaluation + BUY/SELL/HOLD |

## Where to put your own logic

- Strategy rules: `apps/api/src/signals/signals.service.ts` (marked with `TODO`)
- Indicators: `apps/api/src/indicators/indicators.service.ts`
- Shared types: `packages/shared/src/index.ts`

## Architecture notes

### Subscribe-based sources

Two interfaces expose a `subscribe(filter, handler) → Unsubscribe` pattern (no RxJS dependency today):

- `OrderExecution` (`apps/api/src/order-execution/order-execution.types.ts`) — fans order lifecycle events out to demo-balance + trade-history consumers.
- `MarketDataSource` (`apps/api/src/market-data/market-data.types.ts`) — fans price ticks out to consumers (none yet).

**When to migrate to RxJS** — adopt `rxjs` Subjects/Observables behind these APIs when any of these first becomes true:

1. A second `MarketDataSource` subscriber appears (chart + S/R + automation all reading ticks).
2. We need `throttleTime` / `bufferTime` / `scan` (e.g. "compute S/R levels from the last 5 minutes of ticks").
3. We need replay (`shareReplay({ bufferSize: 50 })` — new subscriber gets the last 50 ticks).
4. We need `merge` of multiple sources (tick stream + fill stream into a single market-activity view).

Migration path is small: wrap each source's internal `Map<filter, Set<handler>>` with a `Subject<T>`, expose `subscribe()` returning a plain Observable, keep the current `subscribe(filter, handler) → Unsubscribe` API as a thin shim so existing consumers don't change.

### Validation

Cross-API shapes are Zod schemas in `packages/shared/src/schemas/`. See [VALIDATION.md](./VALIDATION.md) for the recipe (DTO → `@Body()` → service).

## Environment

Copy `apps/api/.env.example` → `apps/api/.env` and
`apps/web/.env.local.example` → `apps/web/.env.local` (both are pre-created for
local dev). Key variables:

| Variable             | App | Default                             |
| -------------------- | --- | ----------------------------------- |
| `PORT`               | api | `3001`                              |
| `DATABASE_URL`       | api | `postgresql://trading:trading@localhost:5433/trading` |
| `PRICE_SYNC_ENABLED` | api | `false` — set `true` to persist candles every minute |
| `NEXT_PUBLIC_API_URL`| web | `http://localhost:3001`             |
