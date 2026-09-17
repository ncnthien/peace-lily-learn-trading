'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'activeAccountId';

function readStoredAccountId(): string | null {
  if (typeof window === 'undefined') return null;
  const value = window.localStorage.getItem(STORAGE_KEY);
  if (value === null || value === '') return null;
  return value;
}

function writeStoredAccountId(id: string | null): void {
  if (typeof window === 'undefined') return;
  if (id === null) {
    window.localStorage.removeItem(STORAGE_KEY);
  } else {
    window.localStorage.setItem(STORAGE_KEY, id);
  }
}

/**
 * Tracks the currently-active account across the app, persisted to
 * localStorage. Pages that consume account-scoped data (PnL, history,
 * automation) will read this hook to know which account to filter by.
 *
 * SSR-safe: returns `null` until the client mounts and reads localStorage.
 */
export function useActiveAccountId(): {
  accountId: string | null;
  setAccountId: (id: string | null) => void;
  isHydrated: boolean;
} {
  const [accountId, setAccountIdState] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    // Sync from localStorage on mount — necessary because the initial
    // render must run on the server with no localStorage access.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAccountIdState(readStoredAccountId());
    setIsHydrated(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setAccountIdState(readStoredAccountId());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setAccountId = useCallback((id: string | null) => {
    writeStoredAccountId(id);
    setAccountIdState(id);
  }, []);

  return { accountId, setAccountId, isHydrated };
}
