'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  useAccounts,
  type CreateAccountDraft,
  type UpdateAccountPatch,
  type AccountRecord,
} from '@/hooks/use-accounts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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

type FilterType = 'all' | 'real' | 'demo';
type AccountType = 'real' | 'demo';

function formatBalance(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

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
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Accounts</h1>
            <p className="text-sm text-muted-foreground">
              Manage trading accounts (real & demo).
            </p>
          </div>
          <FilterTabs value={filter} onChange={setFilter} />
        </header>

        <div className="mb-6 grid gap-3 sm:grid-cols-2">
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
    </div>
  );
}

function FilterTabs({ value, onChange }: { value: FilterType; onChange: (v: FilterType) => void }) {
  const tabs: { key: FilterType; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'demo', label: 'Demo' },
    { key: 'real', label: 'Real' },
  ];
  return (
    <div className="flex gap-1 rounded-md bg-muted p-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`rounded px-3 py-1 text-sm font-medium transition-colors ${
            value === t.key
              ? 'bg-background text-foreground ring-1 ring-foreground/10'
              : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function CreateCta({
  type,
  open,
  onOpen,
  onClose,
  onCreate,
  isSubmitting,
  error,
}: {
  type: AccountType;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onCreate: (draft: CreateAccountDraft) => Promise<unknown>;
  isSubmitting: boolean;
  error: unknown;
}) {
  const label = type === 'demo' ? 'Create a demo account' : 'Create a real account';
  const description =
    type === 'demo'
      ? 'Paper-money account — fills instantly via the mock broker.'
      : 'Live-broker account — orders go through the platform API.';

  return (
    <Card
      className={
        type === 'demo'
          ? 'border-purple-500/40 bg-purple-500/5'
          : 'border-blue-500/40 bg-blue-500/5'
      }
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle
              className={
                type === 'demo' ? 'text-purple-200' : 'text-blue-200'
              }
            >
              {label}
            </CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          {!open && (
            <Button
              onClick={onOpen}
              size="sm"
              variant={type === 'demo' ? 'secondary' : 'secondary'}
              className={
                type === 'demo'
                  ? 'bg-purple-500/20 text-purple-100 hover:bg-purple-500/30 border-purple-500/40'
                  : 'bg-blue-500/20 text-blue-100 hover:bg-blue-500/30 border-blue-500/40'
              }
            >
              + New
            </Button>
          )}
        </div>
      </CardHeader>
      {open && (
        <CardContent>
          <CreateForm
            type={type}
            onCreate={onCreate}
            onCancel={onClose}
            isSubmitting={isSubmitting}
            error={error}
          />
        </CardContent>
      )}
    </Card>
  );
}

function CreateForm({
  type,
  onCreate,
  onCancel,
  isSubmitting,
  error,
}: {
  type: AccountType;
  onCreate: (draft: CreateAccountDraft) => Promise<unknown>;
  onCancel: () => void;
  isSubmitting: boolean;
  error: unknown;
}) {
  const [name, setName] = useState('');
  const [balance, setBalance] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (trimmedName.length === 0) return;
    const draft: CreateAccountDraft = { name: trimmedName, type };
    if (balance.trim() !== '') {
      const n = Number(balance);
      if (Number.isFinite(n)) draft.balance = n;
    }
    try {
      await onCreate(draft);
      setName('');
      setBalance('');
      onCancel();
    } catch {
      // error surfaced via `error` prop
    }
  };

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 md:grid-cols-[1fr,160px,auto]">
      <div>
        <Label htmlFor={`new-${type}-name`}>Name</Label>
        <Input
          id={`new-${type}-name`}
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={type === 'demo' ? 'e.g. Main Demo' : 'e.g. Binance Spot'}
        />
      </div>
      <div>
        <Label htmlFor={`new-${type}-balance`}>Initial balance</Label>
        <Input
          id={`new-${type}-balance`}
          type="number"
          step="any"
          value={balance}
          onChange={(e) => setBalance(e.target.value)}
          placeholder="0"
        />
      </div>
      <div className="flex items-end gap-2">
        <Button type="submit" disabled={isSubmitting || name.trim().length === 0}>
          {isSubmitting ? 'Creating…' : 'Create'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
      </div>
      {error !== null && error !== undefined && (
        <p className="md:col-span-3 text-sm text-destructive">{errorMessage(error)}</p>
      )}
    </form>
  );
}

function AccountRow({
  account,
  onUpdate,
  onDelete,
  updateError,
  deleteError,
}: {
  account: AccountRecord;
  onUpdate: (id: string, patch: UpdateAccountPatch) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
  updateError: unknown;
  deleteError: unknown;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(account.name);
  const [status, setStatus] = useState<'active' | 'disabled'>(account.status);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    setIsSubmitting(true);
    try {
      const patch: UpdateAccountPatch = {};
      if (trimmed !== account.name) patch.name = trimmed;
      if (status !== account.status) patch.status = status;
      if (patch.name !== undefined || patch.status !== undefined) {
        await onUpdate(account.id, patch);
      }
      setEditing(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setName(account.name);
    setStatus(account.status);
    setEditing(false);
  };

  const handleDelete = async () => {
    setConfirmOpen(false);
    await onDelete(account.id);
  };

  if (editing) {
    return (
      <li className="grid gap-3 py-4 md:grid-cols-[1fr,140px,140px,auto]">
        <Input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Input
          type="text"
          value={account.type}
          disabled
          aria-label="Type (immutable)"
          className="opacity-60"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as 'active' | 'disabled')}
          aria-label="Status"
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="active">active</option>
          <option value="disabled">disabled</option>
        </select>
        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={isSubmitting || name.trim().length === 0}>
            Save
          </Button>
          <Button variant="outline" onClick={handleCancel} disabled={isSubmitting}>
            Cancel
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="grid items-center gap-3 py-4 md:grid-cols-[1fr,140px,140px,auto]">
      <div>
        <div className="font-medium">{account.name}</div>
        <div className="text-xs text-muted-foreground">
          Balance <span className="tabular-nums">${formatBalance(account.balance)}</span> · Created {formatDate(account.createdAt)}
        </div>
      </div>
      <div>
        <Badge variant={account.type === 'demo' ? 'secondary' : 'default'}>{account.type}</Badge>
      </div>
      <div>
        <Badge
          variant={account.status === 'active' ? 'outline' : 'secondary'}
          className={
            account.status === 'active'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              : ''
          }
        >
          {account.status}
        </Badge>
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button variant="destructive" size="sm" onClick={() => setConfirmOpen(true)}>
          Delete
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete account &ldquo;{account.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. The account and its references will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {(updateError !== null && updateError !== undefined) || (deleteError !== null && deleteError !== undefined) ? (
        <p className="md:col-span-4 text-sm text-destructive">
          {updateError !== null && updateError !== undefined
            ? `Update failed: ${errorMessage(updateError)}`
            : ''}
          {deleteError !== null && deleteError !== undefined
            ? `Delete failed: ${errorMessage(deleteError)}`
            : ''}
        </p>
      ) : null}
    </li>
  );
}

function EmptyState({ filter }: { filter: FilterType }) {
  const label = filter === 'all' ? 'accounts' : `${filter} accounts`;
  return (
    <div className="flex h-32 flex-col items-center justify-center gap-1 text-muted-foreground">
      <p className="text-sm">No {label} yet.</p>
      <p className="text-xs">Use one of the buttons above to create one.</p>
    </div>
  );
}
