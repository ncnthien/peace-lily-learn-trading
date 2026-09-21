'use client';

import { useState } from 'react';
import type { CreateAccountDraft } from '@workspace/shared';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Label } from '@/shared/ui/label';
import { errorMessage } from './lib/format';

/**
 * Inline create-account form. Used by `<CreateCta>` for both demo and real
 * accounts. Owns its own `name` / `initial balance` state; submission is
 * delegated to the `onCreate` callback (the page owns the actual mutation
 * via `useAccounts`).
 */

export type AccountType = 'real' | 'demo';

export function CreateForm({
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
        <Button
          type="submit"
          disabled={isSubmitting || name.trim().length === 0}
        >
          {isSubmitting ? 'Creating…' : 'Create'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
      </div>
      {error !== null && error !== undefined && (
        <p className="md:col-span-3 text-sm text-destructive">
          {errorMessage(error)}
        </p>
      )}
    </form>
  );
}
