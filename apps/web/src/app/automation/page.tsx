'use client';

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AccountSelector } from '@/components/account-selector';
import { useActiveAccountId } from '@/hooks/use-active-account';
import { useAutomationItems } from '@/hooks/use-automation';

function statusVariant(
  status: 'enabled' | 'disabled' | 'paused',
): 'default' | 'secondary' | 'outline' {
  if (status === 'enabled') return 'default';
  if (status === 'paused') return 'outline';
  return 'secondary';
}

function statusClass(status: 'enabled' | 'disabled' | 'paused'): string {
  if (status === 'enabled') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  return '';
}

function inputSummary(input: { kind: string; [k: string]: unknown }): string {
  if (input.kind === 'time') return `cron: ${String(input.cron ?? '?')}`;
  if (input.kind === 'rsiEmaWave')
    return `${String(input.symbol ?? '?')} @ ${String(input.interval ?? '?')}`;
  if (input.kind === 'supportResistance')
    return `${String(input.symbol ?? '?')} @ ${String(input.interval ?? '?')} (minTouches ${String(input.minTouches ?? '?')})`;
  return JSON.stringify(input);
}

export default function AutomationPage() {
  const { accountId, isHydrated } = useActiveAccountId();
  const filter = isHydrated && accountId !== null ? { accountId } : undefined;
  const { items, isLoading, error } = useAutomationItems(filter);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link
              href="/"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              ← Back to dashboard
            </Link>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Automation</h1>
            <p className="text-sm text-muted-foreground">
              Rules that trigger buy/sell actions when their input signal fires.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <AccountSelector />
            <Button variant="outline" size="sm" disabled title="Coming in NCN-18">
              + New rule
            </Button>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>
              {items.length} rule{items.length === 1 ? '' : 's'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {error !== null && error !== undefined && (
              <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                Failed to load automation rules: {String(error)}
              </div>
            )}

            {isLoading ? (
              <div className="flex h-32 items-center justify-center text-muted-foreground">
                Loading rules…
              </div>
            ) : items.length === 0 ? (
              <div className="flex h-32 flex-col items-center justify-center gap-1 text-muted-foreground">
                <p className="text-sm">
                  {isHydrated && accountId === null
                    ? 'Select an account above to view its automation rules.'
                    : 'No automation rules yet for this account.'}
                </p>
                <p className="text-xs">
                  The rule builder UI lands in NCN-18.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((item) => (
                  <li key={item.id} className="grid items-center gap-3 py-4 md:grid-cols-[1fr,auto,auto,auto]">
                    <div>
                      <div className="font-medium">{item.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {inputSummary(item.input)}
                      </div>
                    </div>
                    <Badge
                      variant={statusVariant(item.status)}
                      className={statusClass(item.status)}
                    >
                      {item.status}
                    </Badge>
                    <code className="text-xs text-muted-foreground">
                      {item.input.kind}
                    </code>
                    <Button variant="outline" size="sm" disabled title="Coming in NCN-18">
                      Edit
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
