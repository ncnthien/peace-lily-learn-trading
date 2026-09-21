'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AccountSelector } from '@/components/account-selector';
import { useActiveAccountId } from '@/hooks/use-active-account';
import { useAutomationItems } from '@/hooks/use-automation';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AutomationFormDialog } from '@/components/automation/automation-form-dialog';
import type { AutomationItem, ConditionNode } from '@/lib/api';
import type { CreateAutomationInput, UpdateAutomationInput } from '@workspace/shared';

function isComposite(node: ConditionNode): node is { operator: 'and' | 'or'; children: ConditionNode[] } {
  return 'operator' in node && 'children' in node;
}

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

function conditionSummary(node: ConditionNode): string {
  if (isComposite(node)) {
    return `${node.operator.toUpperCase()} of ${node.children.length} condition${node.children.length === 1 ? '' : 's'}`;
  }
  const leaf = node as { type?: string; [k: string]: unknown };
  switch (leaf.type) {
    case 'rsi_above':
      return `RSI > ${String(leaf.threshold)}`;
    case 'rsi_below':
      return `RSI < ${String(leaf.threshold)}`;
    case 'wave_direction':
      return `wave ${String(leaf.direction)}`;
    case 'wave_contained_in': {
      const r = leaf.timeRange as { start?: number; end?: number };
      return `wave in [${String(r.start ?? '?')}–${String(r.end ?? '?')}]`;
    }
    case 'wave_phase_not':
      return `wave ≠ ${String(leaf.phase)}`;
    case 'legacy_pass':
      return 'legacy (needs re-author)';
    default:
      return `unknown (${String(leaf.type ?? '?')})`;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface AutomationRowProps {
  item: AutomationItem;
  onEdit: (item: AutomationItem) => void;
  onToggleStatus: (item: AutomationItem) => Promise<unknown>;
  onDelete: (item: AutomationItem) => Promise<unknown>;
  isUpdating: boolean;
  isDeleting: boolean;
}

function AutomationRow({
  item,
  onEdit,
  onToggleStatus,
  onDelete,
  isUpdating,
  isDeleting,
}: AutomationRowProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isEnabled = item.status === 'enabled';

  return (
    <li className="grid items-start gap-3 py-4 md:grid-cols-[1fr,auto,auto,auto,auto]">
      <div className="min-w-0">
        <div className="truncate font-medium">{item.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {inputSummary(item.input)}
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground">
          when <span className="font-mono text-foreground/80">{conditionSummary(item.condition)}</span>
        </div>
      </div>
      <Badge
        variant={statusVariant(item.status)}
        className={statusClass(item.status)}
      >
        {item.status}
      </Badge>
      <code className="text-xs text-muted-foreground">{item.input.kind}</code>
      <div className="flex gap-2 justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onEdit(item)}
          disabled={isUpdating || isDeleting}
        >
          Edit
        </Button>
        <Button
          variant={isEnabled ? 'outline' : 'secondary'}
          size="sm"
          onClick={() => void onToggleStatus(item)}
          disabled={isUpdating || isDeleting}
          aria-label={isEnabled ? 'Disable rule' : 'Enable rule'}
        >
          {isEnabled ? 'Disable' : 'Enable'}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setConfirmOpen(true)}
          disabled={isUpdating || isDeleting}
        >
          Delete
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete rule &ldquo;{item.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. The rule will stop firing on the next runner tick.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void onDelete(item)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

export default function AutomationPage() {
  const { accountId, isHydrated } = useActiveAccountId();
  const filter = isHydrated && accountId !== null ? { accountId } : undefined;
  const {
    items,
    isLoading,
    error,
    create,
    update,
    remove,
    isCreating,
    isUpdating,
    isDeleting,
    createError,
    updateError,
  } = useAutomationItems(filter);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AutomationItem | undefined>(undefined);

  const handleNew = () => {
    setEditing(undefined);
    setFormOpen(true);
  };
  const handleEdit = (item: AutomationItem) => {
    setEditing(item);
    setFormOpen(true);
  };
  const handleSubmit = async (
    draft: Pick<CreateAutomationInput, 'name' | 'input' | 'condition' | 'action'>,
  ) => {
    if (editing !== undefined) {
      const patch: UpdateAutomationInput = draft;
      await update(editing.id, patch);
    } else {
      if (accountId === null) throw new Error('Select an account first');
      const createDraft: CreateAutomationInput = { accountId, ...draft };
      await create(createDraft);
    }
  };
  const handleToggleStatus = async (item: AutomationItem) => {
    const next = item.status === 'enabled' ? 'disabled' : 'enabled';
    await update(item.id, { status: next });
  };
  const handleDelete = async (item: AutomationItem) => {
    await remove(item.id);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link
              href="/"
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              ← Back to signals
            </Link>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Automation</h1>
            <p className="text-sm text-muted-foreground">
              Rules that trigger buy/sell actions when their input signal fires.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/dashboard">
              <Button variant="outline" size="sm">Dashboard</Button>
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <AccountSelector />
            <Button
              variant="outline"
              size="sm"
              onClick={handleNew}
              // No `disabled` guard: the dialog renders a "Pick an
              // account first" empty state when no account is selected,
              // so the button is always useful regardless of state.
              title="Create a new rule"
            >
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
                Failed to load automation rules: {errorMessage(error)}
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
                  {isHydrated && accountId !== null
                    ? 'Click + New rule above to create one.'
                    : 'Select an account above to start.'}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((item) => (
                  <AutomationRow
                    key={item.id}
                    item={item}
                    onEdit={handleEdit}
                    onToggleStatus={handleToggleStatus}
                    onDelete={handleDelete}
                    isUpdating={isUpdating}
                    isDeleting={isDeleting}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <AutomationFormDialog
        // Keyed by the edited item id (or 'new' for create) so opening
        // for a different rule remounts a fresh form with the right
        // initial state. Avoids useEffect-based state syncing.
        key={editing?.id ?? 'new'}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        item={editing}
        accountId={accountId}
        onSubmit={handleSubmit}
        isSubmitting={isCreating || isUpdating}
        error={
          editing !== undefined
            ? (updateError ?? null)
            : (createError ?? null)
        }
      />
    </div>
  );
}