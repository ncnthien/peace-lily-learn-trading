'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { TradeHistoryPage, TradeListFilters } from '@workspace/shared';
import { TRADE_HISTORY_DEFAULT_LIMIT } from '@workspace/shared';
import { apiGet } from '@/shared/lib/http';

export interface TradeHistoryKey {
  filters: TradeListFilters;
  cursor: string | null;
  limit: number;
}

function buildKey(key: TradeHistoryKey): readonly unknown[] {
  return ['trade-history', key.filters, key.cursor, key.limit] as const;
}

/**
 * Builds the query string for `/trades/page`. Empty / undefined fields
 * are omitted; valid ISO datetimes for `from` / `to`; `source` is sent
 * as the literal string the user picked.
 */
function buildQuery(key: TradeHistoryKey): string {
  const params = new URLSearchParams();
  if (key.filters.accountId !== undefined) params.set('accountId', key.filters.accountId);
  if (key.filters.from !== undefined) params.set('from', key.filters.from);
  if (key.filters.to !== undefined) params.set('to', key.filters.to);
  if (key.filters.source !== undefined) params.set('source', key.filters.source);
  if (key.cursor !== null) params.set('cursor', key.cursor);
  if (key.limit !== TRADE_HISTORY_DEFAULT_LIMIT) params.set('limit', String(key.limit));
  const qs = params.toString();
  return `/trades/page${qs !== '' ? `?${qs}` : ''}`;
}

export async function fetchTradeHistoryPage(key: TradeHistoryKey): Promise<TradeHistoryPage> {
  return apiGet<TradeHistoryPage>(buildQuery(key));
}

/**
 * Hook form. `enabled = false` skips the request; pass `enabled: false`
 * explicitly when there is no active account, so the page renders its
 * empty state without a wasted round-trip.
 */
export function useTradeHistoryPage(
  key: TradeHistoryKey,
  enabled: boolean,
) {
  const queryKey = useMemo(() => buildKey(key), [key]);
  return useQuery({
    queryKey,
    enabled,
    queryFn: () => fetchTradeHistoryPage(key),
    placeholderData: keepPreviousData,
  });
}
