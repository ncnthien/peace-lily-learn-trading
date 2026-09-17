'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { fetchAutomationItems, type AutomationItem } from '@/lib/api';

export function useAutomationItems(filter?: { accountId?: string }) {
  const queryKey = useMemo(() => ['automation', filter ?? {}] as const, [filter]);
  const query = useQuery({
    queryKey,
    queryFn: () => fetchAutomationItems(filter),
  });
  return {
    items: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}

export type { AutomationItem };
