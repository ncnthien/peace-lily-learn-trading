'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import type { CandleWithIndicators, SignalDecision, SupportResistanceResult, Timeframe } from '@workspace/shared';
import { apiGet } from '@/lib/api';
import { loadSavedView } from '@/lib/view-state';

const SYMBOL = 'BTCUSDT';
const REFRESH_MS = 30_000;
const INITIAL_CANDLES = 500;
const OLDER_PAGE_SIZE = 1000;

// ----- GET fetchers (local to the hooks that use them) -----

export async function fetchIndicatorCandles(
  symbol: string,
  interval: Timeframe,
  limit = 200,
  endTime?: number,
): Promise<CandleWithIndicators[]> {
  const params = new URLSearchParams({ symbol, interval, limit: String(limit) });
  if (endTime !== undefined) params.set('endTime', String(endTime));
  return apiGet<CandleWithIndicators[]>(`/indicators/candles?${params}`);
}

export async function fetchLatestSignal(
  symbol: string,
  interval: Timeframe,
  limit = 200,
): Promise<SignalDecision> {
  return apiGet<SignalDecision>(
    `/signals/latest?symbol=${symbol}&interval=${interval}&limit=${limit}`,
  );
}

export async function fetchSrLevels(
  symbol: string,
  interval: Timeframe,
): Promise<SupportResistanceResult> {
  return apiGet<SupportResistanceResult>(
    `/indicators/levels?symbol=${symbol}&interval=${interval}`,
  );
}

// ----- Hooks -----

export interface KlinesPage {
  endTime?: number;
  candles: CandleWithIndicators[];
}

function flattenPages(pages: KlinesPage[] | undefined): CandleWithIndicators[] {
  if (!pages) return [];
  const byOpenTime = new Map<number, CandleWithIndicators>();
  for (const page of pages) {
    for (const candle of page.candles) {
      byOpenTime.set(candle.openTime, candle);
    }
  }
  return [...byOpenTime.values()].sort((a, b) => a.openTime - b.openTime);
}

function mergeLive(
  base: CandleWithIndicators[],
  live: CandleWithIndicators[] | undefined,
): CandleWithIndicators[] {
  if (!live || live.length === 0) return base;
  const byOpenTime = new Map<number, CandleWithIndicators>(base.map((c) => [c.openTime, c]));
  for (const candle of live) byOpenTime.set(candle.openTime, candle);
  return [...byOpenTime.values()].sort((a, b) => a.openTime - b.openTime);
}

export function useCandles(interval: Timeframe) {
  const query = useInfiniteQuery({
    queryKey: ['klines', interval],
    initialPageParam: null as number | null,
    queryFn: async ({
      pageParam,
    }: {
      pageParam: number | null;
    }): Promise<KlinesPage> => {
      if (pageParam === null) {
        return { candles: await fetchIndicatorCandles(SYMBOL, interval, INITIAL_CANDLES) };
      }
      return {
        endTime: pageParam,
        candles: await fetchIndicatorCandles(SYMBOL, interval, OLDER_PAGE_SIZE, pageParam),
      };
    },
    getNextPageParam: () => undefined,
    getPreviousPageParam: (firstPage: KlinesPage): number | undefined => {
      const oldest = firstPage.candles[0];
      return oldest ? oldest.openTime - 1 : undefined;
    },
  });

  // Restore history depth saved with the view: keep loading older pages until
  // the saved view's earliest bar is covered (or Binance history is exhausted)
  const { data, hasPreviousPage, isFetchingPreviousPage, fetchPreviousPage } = query;
  const depthReady = useMemo(() => {
    const pages = data?.pages;
    if (pages === undefined) return false;
    const target = loadSavedView()?.earliestBar;
    if (target === undefined) return true;
    const all = flattenPages(pages);
    if (all.length === 0) return false;
    const earliest = all[0].openTime / 1000;
    return earliest <= target + 1 || !hasPreviousPage;
  }, [data, hasPreviousPage]);

  useEffect(() => {
    const pages = data?.pages;
    if (pages === undefined) return;
    const target = loadSavedView()?.earliestBar;
    if (target === undefined) return;
    const all = flattenPages(pages);
    if (all.length === 0) return;
    const earliest = all[0].openTime / 1000;
    if (earliest <= target + 1 || !hasPreviousPage) return;
    if (!isFetchingPreviousPage) {
      void fetchPreviousPage();
    }
  }, [data, hasPreviousPage, isFetchingPreviousPage, fetchPreviousPage]);

  const liveQuery = useQuery({
    queryKey: ['klines-live', interval],
    queryFn: () => fetchIndicatorCandles(SYMBOL, interval, 2),
    refetchInterval: REFRESH_MS,
  });

  const candles = useMemo(
    () => mergeLive(flattenPages(query.data?.pages), liveQuery.data),
    [query.data, liveQuery.data],
  );

  return { ...query, candles, depthReady };
}

export function useSignal(interval: Timeframe) {
  return useQuery({
    queryKey: ['signal', interval],
    queryFn: () => fetchLatestSignal(SYMBOL, interval, 200),
    refetchInterval: REFRESH_MS,
  });
}

export function useSrLevels(interval: Timeframe) {
  return useQuery({
    queryKey: ['sr-levels', interval],
    queryFn: () => fetchSrLevels(SYMBOL, interval),
    refetchInterval: REFRESH_MS,
  });
}
