'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Check, ChevronDown, Settings, UserRound } from 'lucide-react';
import { Badge } from '@/shared/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu';
import { useActiveAccountId, useAccounts, type AccountRecord } from '@/entities/account';
import { cn } from '@/shared/lib/utils';

function initials(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return '?';
  // First non-whitespace character uppercased — works for single names
  // ("Binance") and "First Last" alike without splitting.
  return trimmed.charAt(0).toUpperCase();
}

/**
 * Avatar dropdown anchored to the right side of the header. Lists active
 * accounts for switching and exposes the Settings route. Hydration-safe:
 * shows the same pulsing placeholder used by `AccountSelector` until the
 * localStorage-backed `useActiveAccountId` resolves.
 */
export function AccountAvatarMenu() {
  const { accountId, setAccountId, isHydrated } = useActiveAccountId();
  const { accounts, isLoading } = useAccounts();

  const activeAccounts = useMemo<AccountRecord[]>(
    () => accounts.filter((a) => a.status === 'active'),
    [accounts],
  );

  const activeAccount = useMemo<AccountRecord | null>(
    () => activeAccounts.find((a) => a.id === accountId) ?? null,
    [activeAccounts, accountId],
  );

  if (!isHydrated || isLoading) {
    return (
      <div
        aria-hidden
        className="h-8 w-[120px] rounded-md border border-input bg-input/30 animate-pulse"
      />
    );
  }

  const triggerLabel = activeAccount?.name ?? 'Account';
  const triggerInitial = activeAccount !== null ? initials(activeAccount.name) : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={activeAccount !== null ? `Account: ${triggerLabel}` : 'Open account menu'}
        className="group/avatar flex h-8 items-center gap-2 rounded-md border border-transparent px-1.5 hover:bg-muted"
      >
        <span
          className={cn(
            'flex size-6 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase text-foreground/80',
            activeAccount !== null && activeAccount.type === 'demo' && 'bg-purple-500/20 text-purple-100',
            activeAccount !== null && activeAccount.type === 'real' && 'bg-blue-500/20 text-blue-100',
          )}
        >
          {triggerInitial !== null ? triggerInitial : <UserRound className="size-4" />}
        </span>
        <span className="hidden text-sm font-medium text-foreground sm:inline-block max-w-[140px] truncate">
          {triggerLabel}
        </span>
        <ChevronDown className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="min-w-64">
        {activeAccount !== null && (
          <>
            <div className="flex items-center justify-between gap-3 px-2 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{activeAccount.name}</div>
                <div className="text-xs text-muted-foreground">Active account</div>
              </div>
              <Badge variant={activeAccount.type === 'demo' ? 'secondary' : 'default'}>
                {activeAccount.type}
              </Badge>
            </div>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Switch account</DropdownMenuLabel>
          {activeAccounts.length === 0 ? (
            <DropdownMenuItem disabled>No active accounts</DropdownMenuItem>
          ) : (
            activeAccounts.map((acc) => (
              <DropdownMenuItem
                key={acc.id}
                onClick={() => setAccountId(acc.id)}
                className="justify-between"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      'flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold uppercase',
                      acc.type === 'demo'
                        ? 'bg-purple-500/20 text-purple-100'
                        : 'bg-blue-500/20 text-blue-100',
                    )}
                  >
                    {initials(acc.name)}
                  </span>
                  <span className="truncate">{acc.name}</span>
                </span>
                {acc.id === accountId && (
                  <Check className="size-4 text-emerald-400" aria-label="Currently active" />
                )}
              </DropdownMenuItem>
            ))
          )}
          {activeAccounts.length === 0 && (
            <Link
              href="/accounts"
              className="mt-1 block rounded-md px-2 py-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Create one →
            </Link>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          render={<Link href="/settings" />}
          onClick={() => {
            // closeOnClick default is false — the menu closes itself when a
            // selection happens via Menu.Item, so this is mostly defensive.
          }}
        >
          <Settings className="size-4" />
          <span>Settings</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
