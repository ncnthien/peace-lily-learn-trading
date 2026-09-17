'use client';

import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { useAccounts, type AccountRecord } from '@/hooks/use-accounts';
import { useActiveAccountId } from '@/hooks/use-active-account';

/**
 * Active-account picker for the app-wide header. Shows all active
 * accounts (demo + real) in a compact shadcn-styled control. The selected
 * accountId is persisted to localStorage and read across pages.
 *
 * When the persisted selection no longer exists (account deleted, disabled,
 * or list still loading), the component falls back to the first active
 * account and persists that choice.
 */
export function AccountSelector() {
  const { accounts, isLoading } = useAccounts();
  const { accountId, setAccountId, isHydrated } = useActiveAccountId();

  const activeAccounts = useMemo(
    () => accounts.filter((a) => a.status === 'active'),
    [accounts],
  );

  // If the persisted selection is missing (deleted, disabled, or unhydrated),
  // default to the first active account and persist it.
  useEffect(() => {
    if (!isHydrated) return;
    if (activeAccounts.length === 0) {
      if (accountId !== null) setAccountId(null);
      return;
    }
    const exists = activeAccounts.some((a) => a.id === accountId);
    if (!exists) setAccountId(activeAccounts[0]!.id);
  }, [isHydrated, activeAccounts, accountId, setAccountId]);

  if (!isHydrated || isLoading) {
    return (
      <div className="h-9 w-[200px] rounded-md border border-input bg-input/30 animate-pulse" />
    );
  }

  if (activeAccounts.length === 0) {
    return (
      <Link
        href="/accounts"
        className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Create your first account →
      </Link>
    );
  }

  const selected = activeAccounts.find((a) => a.id === accountId) ?? activeAccounts[0]!;

  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="Active account"
        value={selected.id}
        onChange={(e) => setAccountId(e.target.value)}
        className="h-9 rounded-md border border-input bg-input/30 px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {activeAccounts.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name} ({account.type})
          </option>
        ))}
      </select>
      <Badge variant={selected.type === 'demo' ? 'secondary' : 'default'}>{selected.type}</Badge>
    </div>
  );
}

export type { AccountRecord };
