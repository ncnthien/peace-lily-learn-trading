'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { AccountDashboard, PnlBucket } from '@workspace/shared';
import { apiGet } from '@/lib/api';

/**
 * Fetches the dashboard payload for an account (NCN-22):
 * balance + equity + total realized + total unrealized + the
 * bucketed realized-PnL time series. The query is keyed by
 * `[accountId, bucket]` so toggling the bucket re-runs.
 */
export function useAccountDashboard(accountId: string | null, bucket: PnlBucket) {
  const queryKey = useMemo(
    () => ['account-dashboard', accountId ?? null, bucket] as const,
    [accountId, bucket],
  );
  return useQuery({
    queryKey,
    enabled: accountId !== null,
    queryFn: () => fetchAccountDashboard(accountId as string, bucket),
    refetchInterval: 30_000, // keep equity fresh-ish; matches the signals-page cadence
  });
}

export async function fetchAccountDashboard(
  accountId: string,
  bucket: PnlBucket,
): Promise<AccountDashboard> {
  return apiGet<AccountDashboard>(
    `/accounts/${accountId}/dashboard?bucket=${bucket}`,
  );
}
