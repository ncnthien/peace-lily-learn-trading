'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { PnlBucket } from '@workspace/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { useActiveAccountId } from '@/entities/account';
import { useAccountDashboard } from '@/entities/dashboard';

/**
 * Account dashboard (NCN-22).
 *
 * Reads the active account from {@link useActiveAccountId} (NCN-11) and
 * pulls `/accounts/:id/dashboard` (balance, equity, totals + bucketed
 * PnL series). The user can flip the bucket between day / week / month.
 * Sparse series: empty bars are rendered as a single row explaining the
 * account has no closed-sell history yet.
 */

const BUCKETS: ReadonlyArray<{ value: PnlBucket; label: string }> = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

function fmtCurrency(value: number | null, digits = 2): string {
  if (value === null) return '—';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  return `${sign}$${abs.toFixed(digits)}`;
}

function fmtSigned(value: number | null, digits = 2): string {
  if (value === null) return '—';
  if (value === 0) return '0.00';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '+';
  return `${sign}${abs.toFixed(digits)}`;
}

function bucketLabel(bucket: PnlBucket, iso: string): string {
  // bucketStart is YYYY-MM-DD (week ends on Monday; month starts on day 01)
  if (bucket === 'month') return iso.slice(0, 7);
  return iso;
}

function pnlTone(pnl: number): string {
  if (pnl > 0) return 'bg-emerald-500';
  if (pnl < 0) return 'bg-red-500';
  return 'bg-muted';
}

export default function DashboardPage() {
  const { accountId, isHydrated } = useActiveAccountId();
  const [bucket, setBucket] = useState<PnlBucket>('day');
  const dashboard = useAccountDashboard(accountId, bucket);

  const summary = dashboard.data ?? null;
  const maxAbs = useMemo(() => {
    const series = summary?.pnlSeries ?? [];
    let m = 0;
    for (const p of series) {
      const abs = Math.abs(p.pnl);
      if (abs > m) m = abs;
    }
    return m;
  }, [summary]);

  // Pre-hydration: don't try to render the empty fallback — the
  // persisted accountId is still arriving from localStorage.
  if (!isHydrated) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="h-9 w-[200px] rounded-md border border-input bg-input/30 animate-pulse" />
      </div>
    );
  }

  if (accountId === null) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        </header>
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            Pick an account to load its dashboard.{' '}
            <Link href="/accounts" className="underline-offset-4 hover:text-foreground hover:underline">
              Create your first account →
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const errorText =
    dashboard.error instanceof Error ? dashboard.error.message : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {summary?.account.name ?? 'Account'} Dashboard
        </h1>
        {summary !== null && (
          <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant={summary.account.type === 'demo' ? 'secondary' : 'default'}>
              {summary.account.type}
            </Badge>
            <span>{summary.account.status}</span>
          </p>
        )}
      </header>

      {errorText !== null && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {errorText}
        </div>
      )}

      <section className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground font-normal">
              Balance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {fmtCurrency(summary?.account.balance ?? null)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Cash on the account</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground font-normal">
              Equity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {fmtCurrency(summary?.equity ?? null)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Balance + unrealized PnL</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground font-normal">
              Realized PnL
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {fmtSigned(summary?.totals.realized ?? null)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Closed-sell cum.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-xs uppercase tracking-wider text-muted-foreground font-normal">
              Unrealized PnL
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums">
              {fmtSigned(summary?.totals.unrealized ?? null)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Mark-to-market</p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <CardTitle className="text-base">Realized PnL over time</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Bucket size {bucket}. Sparse — empty buckets are not drawn.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {BUCKETS.map((b) => (
              <Button
                key={b.value}
                size="sm"
                variant={b.value === bucket ? 'default' : 'outline'}
                onClick={() => setBucket(b.value)}
              >
                {b.label}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {dashboard.isLoading && summary === null ? (
            <div className="flex h-[260px] items-center justify-center text-muted-foreground">
              Loading dashboard…
            </div>
          ) : summary === null ? (
            <div className="flex h-[260px] items-center justify-center text-muted-foreground">
              No data
            </div>
          ) : summary.pnlSeries.length === 0 ? (
            <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
              No closed-sell history yet — bucket bars appear once a sell matches a buy.
            </div>
          ) : (
            <div className="space-y-1.5">
              {summary.pnlSeries.map((point) => {
                const width = maxAbs === 0 ? 0 : (Math.abs(point.pnl) / maxAbs) * 50;
                // Lay the bar out symmetrically from a center axis at 50% so
                // both gains (right) and losses (left) are visible.
                return (
                  <div
                    key={point.bucketStart}
                    className="grid grid-cols-[100px_1fr_100px] items-center gap-3 text-xs"
                  >
                    <div className="text-muted-foreground tabular-nums text-right">
                      {bucketLabel(bucket, point.bucketStart)}
                    </div>
                    <div className="relative h-5">
                      <div className="absolute left-1/2 top-1/2 h-px w-full -translate-y-1/2 bg-border" />
                      <div
                        className={`absolute top-1/2 h-3.5 -translate-y-1/2 rounded ${pnlTone(point.pnl)}`}
                        style={{
                          width: `${width}%`,
                          ...(point.pnl < 0
                            ? { right: '50%' }
                            : { left: '50%' }),
                        }}
                      />
                    </div>
                    <div
                      className={`tabular-nums ${
                        point.pnl > 0
                          ? 'text-emerald-400'
                          : point.pnl < 0
                            ? 'text-red-400'
                            : 'text-muted-foreground'
                      }`}
                    >
                      {fmtSigned(point.pnl)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
