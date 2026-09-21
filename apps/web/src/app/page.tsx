'use client';

import { useState } from 'react';
import type { SignalDecision, Timeframe } from '@workspace/shared';
import { Signal, Timeframe as TimeframeValues } from '@workspace/shared';
import { useCandles, useSignal, useSrLevels } from '@/hooks/use-market';
import { usePositionBoxes } from '@/hooks/use-position-boxes';
import { useChartSettings } from '@/hooks/use-setting';
import { PriceChart } from '@/components/price-chart';
import { AccountSelector } from '@/components/account-selector';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

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
  if (signal === Signal.BUY) return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40';
  if (signal === Signal.SELL) return 'bg-red-500/15 text-red-300 border-red-500/40';
  return '';
}

function signalVariant(signal: string | undefined): 'default' | 'destructive' | 'secondary' {
  if (signal === Signal.BUY) return 'default';
  if (signal === Signal.SELL) return 'destructive';
  return 'secondary';
}

export default function DashboardPage() {
  const [interval, setIntervalTf] = useState<Timeframe>(TimeframeValues.ONE_HOUR);
  const candlesQuery = useCandles(interval);
  const signalQuery = useSignal(interval);
  const positionBoxes = usePositionBoxes(SYMBOL, interval);
  const srQuery = useSrLevels(interval);
  const chartSettings = useChartSettings();

  const { candles, isLoading } = candlesQuery;
  const decision: SignalDecision | null = signalQuery.data ?? null;
  const lastCandle = candles.at(-1) ?? null;
  const firstError = candlesQuery.error ?? signalQuery.error;
  const errorText =
    firstError instanceof Error ? firstError.message : firstError ? String(firstError) : null;

  const fmt = (value: number | null, digits = 2): string =>
    value === null ? '—' : value.toFixed(digits);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">
                BTC Trading Signals
              </h1>
              <Link href="/accounts">
                <Button variant="outline" size="sm">Accounts</Button>
              </Link>
              <Link href="/dashboard">
                <Button variant="outline" size="sm">Dashboard</Button>
              </Link>
              <Link href="/automation">
                <Button variant="outline" size="sm">Automation</Button>
              </Link>
            </div>
            <p className="text-sm text-muted-foreground">
              {SYMBOL} · data from Binance · refreshes every 30s
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <AccountSelector />
            <div className="flex flex-wrap gap-2">
              {INTERVALS.map((tf) => (
                <Button
                  key={tf}
                  onClick={() => setIntervalTf(tf)}
                  variant={tf === interval ? 'default' : 'outline'}
                  size="sm"
                >
                  {tf}
                </Button>
              ))}
            </div>
          </div>
        </header>

        {errorText !== null && (
          <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {errorText}
          </div>
        )}

        <section className="mb-6 grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground font-normal">
                Signal
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Badge variant={signalVariant(decision?.signal)} className={`text-base px-3 py-1 ${signalBadgeClass(decision?.signal)}`}>
                {decision?.signal ?? '…'}
              </Badge>
              <p className="mt-2 text-xs text-muted-foreground">
                {decision?.reason ?? (isLoading ? 'Loading…' : '')}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground font-normal">
                Price (BTC/USDT)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tabular-nums">
                ${fmt(decision?.price ?? null, 2)}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {decision?.evaluatedAt !== undefined
                  ? new Date(decision.evaluatedAt).toLocaleString()
                  : ''}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground font-normal">
                Indicators
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-1 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="h-0.5 w-4 bg-purple-500" /> RSI (14)
                  </dt>
                  <dd className="tabular-nums">{fmt(lastCandle?.rsi ?? null)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="h-0.5 w-4 bg-blue-500" /> EMA of RSI (9)
                  </dt>
                  <dd className="tabular-nums">{fmt(lastCandle?.emaRsi ?? null)}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="h-0.5 w-4 bg-yellow-400" /> WMA of RSI (45)
                  </dt>
                  <dd className="tabular-nums">{fmt(lastCandle?.wmaRsi ?? null)}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardContent className="p-4">
            {isLoading && candles.length === 0 ? (
              <div className="flex h-[420px] items-center justify-center text-muted-foreground">
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
