'use client';

import { AccountAvatarMenu } from '@/widgets/account-avatar-menu';

/**
 * Top bar of the persistent app shell. Brand on the left, active-account
 * avatar + dropdown on the right. No per-page navigation buttons — those
 * live in the sidebar.
 */
export function AppHeader() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <span className="text-base font-semibold tracking-tight">
          BTC Trading Signals
        </span>
      </div>
      <div className="flex items-center gap-2">
        <AccountAvatarMenu />
      </div>
    </header>
  );
}
