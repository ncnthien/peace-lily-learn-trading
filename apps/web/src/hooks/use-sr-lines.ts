'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import type { Timeframe } from '@workspace/shared';
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  type SRLineRecord,
} from '@/lib/api';

// ----- GET fetcher (local to this hook) -----

export async function fetchSRLines(
  symbol: string,
  interval: string,
): Promise<SRLineRecord[]> {
  return apiGet<SRLineRecord[]>(`/sr-lines?symbol=${symbol}&interval=${interval}`);
}

// ----- Hook -----

export function useSRLines(symbol: string, interval: Timeframe) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ['sr-lines', symbol, interval] as const,
    [symbol, interval],
  );

  const query = useQuery({
    queryKey,
    queryFn: () => fetchSRLines(symbol, interval),
  });

  const setCache = useCallback(
    (updater: (prev: SRLineRecord[]) => SRLineRecord[]) => {
      queryClient.setQueryData<SRLineRecord[]>(queryKey, (prev) =>
        updater(prev ?? []),
      );
    },
    [queryClient, queryKey],
  );

  const create = useCallback(
    async (kind: 'support' | 'resistance', price: number) => {
      const created = await apiPost<
        SRLineRecord,
        { symbol: string; interval: string; kind: 'support' | 'resistance'; price: number }
      >('/sr-lines', { symbol, interval, kind, price });
      setCache((prev) => [...prev, created]);
    },
    [symbol, interval, setCache],
  );

  const updateLocal = useCallback(
    (id: string, price: number) => {
      setCache((prev) => prev.map((r) => (r.id === id ? { ...r, price } : r)));
    },
    [setCache],
  );

  const commit = useCallback(
    async (id: string, price: number) => {
      try {
        const updated = await apiPatch<SRLineRecord, { price: number }>(
          `/sr-lines/${id}`,
          { price },
        );
        setCache((prev) => prev.map((r) => (r.id === id ? updated : r)));
      } catch {
        // keep local state; next reload resyncs
      }
    },
    [setCache],
  );

  const remove = useCallback(
    async (id: string) => {
      setCache((prev) => prev.filter((r) => r.id !== id));
      await apiDelete(`/sr-lines/${id}`);
    },
    [setCache],
  );

  return { srLines: query.data ?? [], create, updateLocal, commit, remove };
}
