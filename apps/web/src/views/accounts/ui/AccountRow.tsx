'use client';

import { useState } from 'react';
import type { UpdateAccountPatch } from '@workspace/shared';
import type { AccountRecord } from '@/entities/account';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Badge } from '@/shared/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog';
import { errorMessage, formatBalance, formatDate } from './lib/format';

/**
 * Single row in the Accounts list. Drives its own edit-mode state and
 * delete-confirmation dialog. Mutation callbacks are passed in from the
 * page so loading / error states stay centralized.
 */
export function AccountRow({
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
          onChange={(e) =>
            setStatus(e.target.value as 'active' | 'disabled')
          }
          aria-label="Status"
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="active">active</option>
          <option value="disabled">disabled</option>
        </select>
        <div className="flex gap-2">
          <Button
            onClick={handleSave}
            disabled={isSubmitting || name.trim().length === 0}
          >
            Save
          </Button>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isSubmitting}
          >
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
          Balance{' '}
          <span className="tabular-nums">${formatBalance(account.balance)}</span> ·
          Created {formatDate(account.createdAt)}
        </div>
      </div>
      <div>
        <Badge variant={account.type === 'demo' ? 'secondary' : 'default'}>
          {account.type}
        </Badge>
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
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setConfirmOpen(true)}
        >
          Delete
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete account &ldquo;{account.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. The account and its references will be
              removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {(updateError !== null && updateError !== undefined) ||
      (deleteError !== null && deleteError !== undefined) ? (
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
