'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import type { Timeframe } from '@workspace/shared';
import {
  createSRLine,
  deleteSRLine,
  fetchSRLines,
  updateSRLine,
  type SRLineRecord,
} from '@/lib/api';

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
      const created = await createSRLine({ symbol, interval, kind, price });
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
        const updated = await updateSRLine(id, price);
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
      await deleteSRLine(id);
    },
    [setCache],
  );

  return { srLines: query.data ?? [], create, updateLocal, commit, remove };
}
