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
