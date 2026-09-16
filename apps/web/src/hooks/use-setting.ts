'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { fetchSetting, updateSetting } from '@/lib/api';

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
    void updateSetting('chart', next);
  }, [queryClient, queryKey]);

  return { settings: query.data ?? DEFAULT_CHART_SETTINGS, toggleSr };
}
