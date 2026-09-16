'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import type { Timeframe } from '@workspace/shared';
import {
  createPositionBox,
  deletePositionBox,
  fetchPositionBoxes,
  updatePositionBox,
  type PositionBoxRecord,
} from '@/lib/api';

export interface PositionBoxDraft {
  side: 'long' | 'short';
  entryOpenTime: number;
  bars: number;
  entryPrice: number;
  stopPrice: number;
  tpPrice: number;
}

export interface PositionBoxUpdates {
  entryPrice?: number;
  stopPrice?: number;
  tpPrice?: number;
  bars?: number;
}

export function usePositionBoxes(symbol: string, interval: Timeframe) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ['position-boxes', symbol, interval] as const,
    [symbol, interval],
  );

  const query = useQuery({
    queryKey,
    queryFn: () => fetchPositionBoxes(symbol, interval),
  });

  const setCache = useCallback(
    (updater: (prev: PositionBoxRecord[]) => PositionBoxRecord[]) => {
      queryClient.setQueryData<PositionBoxRecord[]>(queryKey, (prev) =>
        updater(prev ?? []),
      );
    },
    [queryClient, queryKey],
  );

  const create = useCallback(
    async (draft: PositionBoxDraft) => {
      const created = await createPositionBox({ symbol, interval, ...draft });
      setCache((prev) => [...prev, created]);
    },
    [symbol, interval, setCache],
  );

  const updateLocal = useCallback(
    (id: string, updates: PositionBoxUpdates) => {
      setCache((prev) => prev.map((r) => (r.id === id ? { ...r, ...updates } : r)));
    },
    [setCache],
  );

  const commit = useCallback(
    async (id: string, updates: PositionBoxUpdates) => {
      try {
        const updated = await updatePositionBox(id, updates);
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
      await deletePositionBox(id);
    },
    [setCache],
  );

  return { boxes: query.data ?? [], create, updateLocal, commit, remove };
}
