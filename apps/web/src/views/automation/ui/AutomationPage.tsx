'use client';

import { useState } from 'react';
import { useActiveAccountId } from '@/entities/account';
import { useAutomationItems, type AutomationItem } from '@/entities/automation';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/card';
import { Button } from '@/shared/ui/button';
import { AutomationFormDialog } from '@/features/manage-automation';
import type { CreateAutomationInput, UpdateAutomationInput } from '@workspace/shared';
import { AutomationRow } from './AutomationRow';
import { errorMessage } from './lib/format';

/**
 * Automation page (NCN-18).
 *
 * Composes the rule list (or its empty state), the "+ New rule" CTA,
 * and the inline create/edit dialog from `features/manage-automation`.
 * All mutations live in `useAutomationItems`; this component owns only
 * the local dialog open/close state and which item is being edited.
 */
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
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Automation</h1>
          <p className="text-sm text-muted-foreground">
            Rules that trigger buy/sell actions when their input signal fires.
          </p>
        </div>
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
                  : 'Pick an account from the avatar menu in the header.'}
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
