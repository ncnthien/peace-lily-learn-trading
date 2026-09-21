'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import type { TradeHistoryRow, TradeListFilters } from '@workspace/shared';
import { TRADE_HISTORY_DEFAULT_LIMIT } from '@workspace/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AccountSelector } from '@/components/account-selector';
import { useActiveAccountId } from '@/hooks/use-active-account';
import { useTradeHistoryPage } from '@/hooks/use-trade-history';

/**
 * Trade history (NCN-23).
 *
 * Filterable + paginated trade list. Filters persist in local URL
 * state (search params) so the view is shareable; pagination uses
 * cursor-based "load more". The active account (NCN-11) is the
 * default, and the filter bar lets the user override it for
 * cross-account look-ups.
 */

type SourceFilter = 'all' | 'manual' | 'automation';

function fmtNumber(value: number, digits = 8): string {
  return value.toFixed(digits).replace(/\.?0+$/, '');
}

function fmtCurrency(value: number, digits = 2): string {
  const sign = value < 0 ? '-' : '';
  return `${sign}$${Math.abs(value).toFixed(digits)}`;
}

function fmtSigned(value: number | null, digits = 2): string {
  if (value === null) return '—';
  if (value === 0) return '0.00';
  const sign = value < 0 ? '-' : '+';
  return `${sign}${Math.abs(value).toFixed(digits)}`;
}

export default function TradesPage() {
  const { accountId: activeAccountId, isHydrated } = useActiveAccountId();
  // Allow overriding the account from local state so the user can
  // inspect another account without losing the active selection.
  const [accountId, setAccountId] = useState<string>(activeAccountId ?? '');
  const [source, setSource] = useState<SourceFilter>('all');
  const [fromDay, setFromDay] = useState<string>('');
  const [toDay, setToDay] = useState<string>('');
  // Accumulates pages of rows; resets on filter change.
  const [accumulated, setAccumulated] = useState<TradeHistoryRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [pageSize] = useState<number>(TRADE_HISTORY_DEFAULT_LIMIT);

  // One-shot hydration: when the persisted active accountId arrives
  // from localStorage, mirror it into the local `accountId` if the user
  // hasn't typed anything yet. Done during render (allowed in React 19
  // when the call bails out the next render) — avoids the
  // cascading-render warning from set-state-in-effect.
  if (isHydrated && activeAccountId !== null && accountId === '') {
    setAccountId(activeAccountId);
  }

  const filters: TradeListFilters = useMemo(() => {
    const out: TradeListFilters = {};
    if (accountId.length > 0) out.accountId = accountId;
    if (fromDay.length > 0) out.from = `${fromDay}T00:00:00.000Z`;
    // `to` is exclusive server-side — push the day's end to midnight-of-next-day in UTC.
    if (toDay.length > 0) {
      const next = new Date(`${toDay}T00:00:00.000Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      out.to = next.toISOString();
    }
    if (source !== 'all') out.source = source;
    return out;
  }, [accountId, fromDay, toDay, source]);

  const key = useMemo(
    () => ({ filters, cursor: cursor ?? null, limit: pageSize }),
    [filters, cursor, pageSize],
  );
  const enabled = accountId.length > 0;
  const query = useTradeHistoryPage(key, enabled);

  // Compute the display list: when `cursor === null`, drop accumulated
  // and show this page's rows; otherwise accumulate.
  const items: TradeHistoryRow[] = useMemo(() => {
    const pageItems = query.data?.items ?? [];
    if (cursor === null) return pageItems;
    return [...accumulated, ...pageItems];
  }, [query.data, cursor, accumulated]);

  const nextCursor = query.data?.nextCursor ?? null;

  const applyFilters = useCallback(() => {
    // Filters changed → reset pagination.
    setCursor(null);
    setAccumulated([]);
  }, []);

  const loadMore = useCallback(() => {
    if (nextCursor === null) return;
    setAccumulated(items);
    setCursor(nextCursor);
  }, [items, nextCursor]);

  if (!isHydrated) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <div className="mx-auto max-w-6xl px-4 py-8">
          <div className="h-9 w-[200px] rounded-md border border-input bg-input/30 animate-pulse" />
        </div>
      </div>
    );
  }

  const errorText =
    query.error instanceof Error ? query.error.message : null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link
              href="/"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              ← Back to signals
            </Link>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Trade history</h1>
            <p className="text-sm text-muted-foreground">
              Filterable list of every fill on every account.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/dashboard">
              <Button variant="outline" size="sm">Dashboard</Button>
            </Link>
            <Link href="/automation">
              <Button variant="outline" size="sm">Automation</Button>
            </Link>
            <AccountSelector />
          </div>
        </header>

        {errorText !== null && (
          <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {errorText}
          </div>
        )}

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Account
                </label>
                <Input
                  placeholder="Account id (UUID)"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Defaults to the active account from the header picker.
                </p>
              </div>
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-wider text-muted-foreground">
                  Source
                </label>
                <Select value={source} onValueChange={(v) => setSource(v as SourceFilter)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="automation">Automation</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-wider text-muted-foreground">
                  From
                </label>
                <Input
                  type="date"
                  value={fromDay}
                  onChange={(e) => setFromDay(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs uppercase tracking-wider text-muted-foreground">
                  To
                </label>
                <Input
                  type="date"
                  value={toDay}
                  onChange={(e) => setToDay(e.target.value)}
                />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Showing {items.length} row{items.length === 1 ? '' : 's'}
                {nextCursor !== null ? ' · more available' : ''}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFromDay('');
                    setToDay('');
                    setSource('all');
                    setAccountId(activeAccountId ?? '');
                    applyFilters();
                  }}
                >
                  Reset
                </Button>
                <Button size="sm" onClick={applyFilters}>
                  Apply
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {!enabled ? (
              <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
                Enter an account id above to load its trade history.
              </div>
            ) : query.isLoading && items.length === 0 ? (
              <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
                Loading trades…
              </div>
            ) : items.length === 0 ? (
              <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
                No trades match these filters.
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Time</th>
                        <th className="px-3 py-2">Symbol</th>
                        <th className="px-3 py-2">Side</th>
                        <th className="px-3 py-2 text-right">Qty</th>
                        <th className="px-3 py-2 text-right">Price</th>
                        <th className="px-3 py-2 text-right">Total</th>
                        <th className="px-3 py-2 text-right">Fee</th>
                        <th className="px-3 py-2">Source</th>
                        <th className="px-3 py-2 text-right">Realized</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((t) => (
                        <tr key={t.id} className="border-b border-border/60 last:border-0">
                          <td className="px-3 py-2 text-muted-foreground tabular-nums whitespace-nowrap">
                            {new Date(t.timestamp).toLocaleString()}
                          </td>
                          <td className="px-3 py-2 font-medium">{t.symbol}</td>
                          <td className="px-3 py-2">
                            <Badge variant={t.side === 'buy' ? 'default' : 'destructive'}>
                              {t.side}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtNumber(t.qty)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtCurrency(t.price)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {fmtCurrency(t.price * t.qty)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {t.fee !== undefined ? fmtCurrency(t.fee) : '—'}
                          </td>
                          <td className="px-3 py-2">
                            {t.automationItemId !== undefined ? (
                              <span title={t.automationItemId}>
                                <Badge variant="secondary">automation</Badge>
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">manual</span>
                            )}
                          </td>
                          <td
                            className={`px-3 py-2 text-right tabular-nums ${
                              t.realizedPnl === null
                                ? 'text-muted-foreground'
                                : t.realizedPnl > 0
                                  ? 'text-emerald-400'
                                  : t.realizedPnl < 0
                                    ? 'text-red-400'
                                    : 'text-muted-foreground'
                            }`}
                          >
                            {fmtSigned(t.realizedPnl)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-center border-t border-border p-3">
                  {nextCursor !== null ? (
                    <Button variant="outline" size="sm" onClick={loadMore}>
                      Load more
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">End of history</span>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
