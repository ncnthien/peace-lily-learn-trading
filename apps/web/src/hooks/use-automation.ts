'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { apiGet, type AutomationItem } from '@/lib/api';

// ----- GET fetcher (local to this hook) -----

export async function fetchAutomationItems(
  filter?: { accountId?: string },
): Promise<AutomationItem[]> {
  const params = new URLSearchParams();
  if (filter?.accountId !== undefined) params.set('accountId', filter.accountId);
  const qs = params.toString();
  return apiGet<AutomationItem[]>(`/automation${qs !== '' ? `?${qs}` : ''}`);
}

// ----- Hook -----

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
