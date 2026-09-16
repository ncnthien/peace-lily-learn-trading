'use client';

import { useState } from 'react';
import type { SignalDecision, Timeframe } from '@workspace/shared';
import { Signal, Timeframe as TimeframeValues } from '@workspace/shared';
import { useCandles, useSignal, useSrLevels } from '@/hooks/use-market';
import { usePositionBoxes } from '@/hooks/use-position-boxes';
import { useChartSettings } from '@/hooks/use-setting';
import { PriceChart } from '@/components/price-chart';

const SYMBOL = 'BTCUSDT';
const INTERVALS = [
  TimeframeValues.FIFTEEN_MINUTES,
  TimeframeValues.ONE_HOUR,
  TimeframeValues.FOUR_HOURS,
  TimeframeValues.ONE_DAY,
  TimeframeValues.TWO_DAYS,
  TimeframeValues.THREE_DAYS,
  TimeframeValues.FOUR_DAYS,
  TimeframeValues.FIVE_DAYS,
  TimeframeValues.SIX_DAYS,
  TimeframeValues.ONE_WEEK,
];

function signalBadgeClass(signal: string | undefined): string {
  if (signal === Signal.BUY) return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40';
  if (signal === Signal.SELL) return 'bg-red-500/15 text-red-400 border-red-500/40';
  return 'bg-slate-500/15 text-slate-300 border-slate-500/40';
}

export default function DashboardPage() {
  const [interval, setIntervalTf] = useState<Timeframe>(TimeframeValues.ONE_HOUR);
  const candlesQuery = useCandles(interval);
  const signalQuery = useSignal(interval);
  const positionBoxes = usePositionBoxes(SYMBOL, interval);
  const srQuery = useSrLevels(interval);
  const chartSettings = useChartSettings();

  const { candles, isLoading, error } = candlesQuery;
  const decision: SignalDecision | null = signalQuery.data ?? null;
  const lastCandle = candles.at(-1) ?? null;
  const firstError = error ?? signalQuery.error;
  const errorText =
    firstError instanceof Error ? firstError.message : firstError ? String(firstError) : null;

  const fmt = (value: number | null, digits = 2): string =>
    value === null ? '—' : value.toFixed(digits);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              BTC Trading Signals
            </h1>
            <p className="text-sm text-slate-400">
              {SYMBOL} · data from Binance · refreshes every 30s
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {INTERVALS.map((tf) => (
              <button
                key={tf}
                onClick={() => setIntervalTf(tf)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  tf === interval
                    ? 'bg-slate-100 text-slate-900'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </header>

        {errorText !== null && (
          <div className="mb-6 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {errorText}
          </div>
        )}

        <section className="mb-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
            <p className="text-xs uppercase tracking-wider text-slate-400">Signal</p>
            <span
              className={`mt-2 inline-block rounded-md border px-3 py-1 text-lg font-semibold ${signalBadgeClass(decision?.signal)}`}
            >
              {decision?.signal ?? '…'}
            </span>
            <p className="mt-2 text-xs text-slate-400">
              {decision?.reason ?? (isLoading ? 'Loading…' : '')}
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
            <p className="text-xs uppercase tracking-wider text-slate-400">
              Price (BTC/USDT)
            </p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              ${fmt(decision?.price ?? null, 2)}
            </p>
            <p className="mt-2 text-xs text-slate-400">
              {decision?.evaluatedAt !== undefined
                ? new Date(decision.evaluatedAt).toLocaleString()
                : ''}
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-5">
            <p className="text-xs uppercase tracking-wider text-slate-400">
              Indicators
            </p>
            <dl className="mt-2 space-y-1 text-sm">
              <div className="flex items-center justify-between">
                <dt className="flex items-center gap-1.5 text-slate-400">
                  <span className="h-0.5 w-4 bg-purple-500" /> RSI (14)
                </dt>
                <dd className="tabular-nums">
                  {fmt(lastCandle?.rsi ?? null)}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="flex items-center gap-1.5 text-slate-400">
                  <span className="h-0.5 w-4 bg-blue-500" /> EMA of RSI (9)
                </dt>
                <dd className="tabular-nums">
                  {fmt(lastCandle?.emaRsi ?? null)}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="flex items-center gap-1.5 text-slate-400">
                  <span className="h-0.5 w-4 bg-yellow-400" /> WMA of RSI (45)
                </dt>
                <dd className="tabular-nums">
                  {fmt(lastCandle?.wmaRsi ?? null)}
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-4">
          {isLoading && candles.length === 0 ? (
            <div className="flex h-[420px] items-center justify-center text-slate-500">
              Loading candles…
            </div>
          ) : (
            <PriceChart
              candles={candles}
              interval={interval}
              loadingOlder={candlesQuery.isFetchingPreviousPage}
              onLoadOlder={
                candlesQuery.hasPreviousPage ? candlesQuery.fetchPreviousPage : undefined
              }
              boxes={positionBoxes.boxes}
              srLevels={srQuery.data?.levels}
              showSr={chartSettings.settings.showSr}
              onToggleSr={chartSettings.toggleSr}
              depthReady={candlesQuery.depthReady}
              onCreateBox={(draft) => void positionBoxes.create(draft)}
              onBoxChange={positionBoxes.updateLocal}
              onBoxCommit={(id, updates) => void positionBoxes.commit(id, updates)}
              onBoxRemove={(id) => void positionBoxes.remove(id)}
            />
          )}
        </section>
      </div>
    </div>
  );
}
