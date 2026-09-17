'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  useAccounts,
  type CreateAccountDraft,
  type UpdateAccountPatch,
  type AccountRecord,
} from '@/hooks/use-accounts';

type FilterType = 'all' | 'real' | 'demo';

const inputBase =
  'w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-slate-400 focus:outline-none';
const labelBase = 'block text-xs font-medium uppercase tracking-wider text-slate-400';
const btnPrimary =
  'rounded-md bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed';
const btnSecondary =
  'rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed';
const btnDanger =
  'rounded-md bg-red-500/15 px-3 py-1.5 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/25 disabled:opacity-50 disabled:cursor-not-allowed';

function formatBalance(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function statusBadgeClass(status: AccountRecord['status']): string {
  return status === 'active'
    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40'
    : 'bg-slate-500/15 text-slate-300 border-slate-500/40';
}

function typeBadgeClass(type: AccountRecord['type']): string {
  return type === 'demo'
    ? 'bg-purple-500/15 text-purple-300 border-purple-500/40'
    : 'bg-blue-500/15 text-blue-300 border-blue-500/40';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function AccountsPage() {
  const [filter, setFilter] = useState<FilterType>('all');
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
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link
              href="/"
              className="text-sm text-slate-400 transition-colors hover:text-slate-200"
            >
              ← Back to dashboard
            </Link>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Accounts</h1>
            <p className="text-sm text-slate-400">
              Manage trading accounts (real & demo).
            </p>
          </div>
          <FilterTabs value={filter} onChange={setFilter} />
        </header>

        <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-200">New account</h2>
          <CreateForm
            onSubmit={create}
            isSubmitting={isCreating}
            error={createError}
          />
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-200">
            {accounts.length} account{accounts.length === 1 ? '' : 's'}
          </h2>

          {error !== null && error !== undefined && (
            <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              Failed to load accounts: {errorMessage(error)}
            </div>
          )}

          {isLoading ? (
            <div className="flex h-32 items-center justify-center text-slate-500">
              Loading accounts…
            </div>
          ) : accounts.length === 0 ? (
            <EmptyState filter={filter} />
          ) : (
            <ul className="divide-y divide-slate-800">
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
        </section>
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
    <div className="flex gap-1 rounded-md bg-slate-900 p-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`rounded px-3 py-1 text-sm font-medium transition-colors ${
            value === t.key
              ? 'bg-slate-100 text-slate-900'
              : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function CreateForm({
  onSubmit,
  isSubmitting,
  error,
}: {
  onSubmit: (draft: CreateAccountDraft) => Promise<unknown>;
  isSubmitting: boolean;
  error: unknown;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'real' | 'demo'>('demo');
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
      await onSubmit(draft);
      setName('');
      setBalance('');
      setType('demo');
    } catch {
      // error surfaced via `error` prop
    }
  };

  return (
    <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-[1fr,160px,160px,auto]">
      <div>
        <label className={labelBase} htmlFor="new-name">
          Name
        </label>
        <input
          id="new-name"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Main Demo"
          className={inputBase}
        />
      </div>
      <div>
        <label className={labelBase} htmlFor="new-type">
          Type
        </label>
        <select
          id="new-type"
          value={type}
          onChange={(e) => setType(e.target.value as 'real' | 'demo')}
          className={inputBase}
        >
          <option value="demo">demo</option>
          <option value="real">real</option>
        </select>
      </div>
      <div>
        <label className={labelBase} htmlFor="new-balance">
          Initial balance
        </label>
        <input
          id="new-balance"
          type="number"
          step="any"
          value={balance}
          onChange={(e) => setBalance(e.target.value)}
          placeholder="0"
          className={inputBase}
        />
      </div>
      <div className="flex items-end">
        <button type="submit" disabled={isSubmitting || name.trim().length === 0} className={btnPrimary}>
          {isSubmitting ? 'Creating…' : 'Create'}
        </button>
      </div>
      {error !== null && error !== undefined && (
        <p className="md:col-span-4 text-sm text-red-400">{errorMessage(error)}</p>
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

  const handleDelete = async () => {
    if (!confirm(`Delete account "${account.name}"? This cannot be undone.`)) return;
    await onDelete(account.id);
  };

  const handleCancel = () => {
    setName(account.name);
    setStatus(account.status);
    setEditing(false);
  };

  if (editing) {
    return (
      <li className="grid gap-3 py-4 md:grid-cols-[1fr,120px,140px,auto]">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputBase}
        />
        <select
          value={account.type}
          disabled
          className={inputBase + ' opacity-60 cursor-not-allowed'}
          aria-label="Type (immutable)"
        >
          <option value="demo">demo</option>
          <option value="real">real</option>
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as 'active' | 'disabled')}
          className={inputBase}
          aria-label="Status"
        >
          <option value="active">active</option>
          <option value="disabled">disabled</option>
        </select>
        <div className="flex gap-2">
          <button onClick={handleSave} disabled={isSubmitting || name.trim().length === 0} className={btnPrimary}>
            Save
          </button>
          <button onClick={handleCancel} disabled={isSubmitting} className={btnSecondary}>
            Cancel
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className="grid items-center gap-3 py-4 md:grid-cols-[1fr,120px,140px,auto]">
      <div>
        <div className="font-medium text-slate-100">{account.name}</div>
        <div className="text-xs text-slate-500">
          Balance ${formatBalance(account.balance)} · Created {formatDate(account.createdAt)}
        </div>
      </div>
      <div>
        <span className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium ${typeBadgeClass(account.type)}`}>
          {account.type}
        </span>
      </div>
      <div>
        <span className={`inline-block rounded-md border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(account.status)}`}>
          {account.status}
        </span>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={() => setEditing(true)} className={btnSecondary}>
          Edit
        </button>
        <button onClick={handleDelete} className={btnDanger}>
          Delete
        </button>
      </div>
      {(updateError !== null && updateError !== undefined) || (deleteError !== null && deleteError !== undefined) ? (
        <p className="md:col-span-4 text-sm text-red-400">
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
    <div className="flex h-32 flex-col items-center justify-center gap-1 text-slate-500">
      <p className="text-sm">No {label} yet.</p>
      <p className="text-xs">Use the form above to create one.</p>
    </div>
  );
}
