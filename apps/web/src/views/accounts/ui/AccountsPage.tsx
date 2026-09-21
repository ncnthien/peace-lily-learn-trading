'use client';

import { useState } from 'react';
import { useAccounts } from '@/entities/account';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card';
import { AccountRow } from './AccountRow';
import { CreateCta } from './CreateCta';
import { EmptyState } from './EmptyState';
import { FilterTabs, type FilterType } from './FilterTabs';
import { errorMessage } from './lib/format';
import type { AccountType } from './CreateForm';

/**
 * Accounts page — composes the filter tabs, the two create CTAs, the
 * list (or its empty state), and the inline edit/delete errors. All
 * mutations live in the `useAccounts` hook; this component only owns
 * the local filter + which CTA is open.
 */
export default function AccountsPage() {
  const [filter, setFilter] = useState<FilterType>('all');
  const [openForm, setOpenForm] = useState<AccountType | null>(null);
  const filterArg = filter === 'all' ? undefined : { type: filter };
  const {
    accounts,
    isLoading,
    error,
    create,
    update,
    remove,
    isCreating,
    createError,
    updateError,
    deleteError,
  } = useAccounts(filterArg);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>
          <p className="text-sm text-muted-foreground">
            Manage trading accounts (real & demo).
          </p>
        </div>
        <FilterTabs value={filter} onChange={setFilter} />
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <CreateCta
          type="demo"
          open={openForm === 'demo'}
          onOpen={() => setOpenForm('demo')}
          onClose={() => setOpenForm(null)}
          onCreate={create}
          isSubmitting={isCreating}
          error={openForm === 'demo' ? createError : null}
        />
        <CreateCta
          type="real"
          open={openForm === 'real'}
          onOpen={() => setOpenForm('real')}
          onClose={() => setOpenForm(null)}
          onCreate={create}
          isSubmitting={isCreating}
          error={openForm === 'real' ? createError : null}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {accounts.length} account{accounts.length === 1 ? '' : 's'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {error !== null && error !== undefined && (
            <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              Failed to load accounts: {errorMessage(error)}
            </div>
          )}

          {isLoading ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">
              Loading accounts…
            </div>
          ) : accounts.length === 0 ? (
            <EmptyState filter={filter} />
          ) : (
            <ul className="divide-y divide-border">
              {accounts.map((account) => (
                <AccountRow
                  key={account.id}
                  account={account}
                  onUpdate={update}
                  onDelete={remove}
                  updateError={updateError}
                  deleteError={deleteError}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
