'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { apiGet, apiPut } from '@/shared/lib/http';

// ----- GET fetcher (local to this hook) -----

export async function fetchSetting<T>(key: string): Promise<T | null> {
  const data = await apiGet<{ value: T | null }>(`/settings/${key}`);
  return data.value;
}

// ----- Hook -----

export interface ChartSettings {
  showSr: boolean;
}

const DEFAULT_CHART_SETTINGS: ChartSettings = { showSr: true };

export function useChartSettings() {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['settings', 'chart'] as const, []);

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const value = await fetchSetting<Partial<ChartSettings>>('chart');
      return { ...DEFAULT_CHART_SETTINGS, ...value };
    },
    staleTime: Number.POSITIVE_INFINITY,
  });

  const toggleSr = useCallback(() => {
    const current = queryClient.getQueryData<ChartSettings>(queryKey) ?? DEFAULT_CHART_SETTINGS;
    const next = { ...current, showSr: !current.showSr };
    queryClient.setQueryData(queryKey, next);
    void apiPut('/settings/chart', { value: next });
  }, [queryClient, queryKey]);

  return { settings: query.data ?? DEFAULT_CHART_SETTINGS, toggleSr };
}
