'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { AutomationItem } from '@/lib/api';
import type { CreateAutomationInput } from '@workspace/shared';
import {
  ActionFields,
  actionDraftFromUnknown,
  actionDraftToZod,
  type ActionDraft,
} from './action-fields';
import {
  ConditionEditor,
  leafDraftFromUnknown,
  leafDraftToZod,
  type LeafDraft,
} from './condition-editor';
import {
  InputKindFields,
  inputDraftFromUnknown,
  inputDraftToZod,
  providerKindFor,
  type InputDraft,
  type InputKind,
} from './input-kind-fields';

/**
 * Create / edit dialog for an AutomationItem (NCN-18).
 *
 * Reuses one component for both flows so the field shapes can't drift.
 * The dialog is keyed by `item?.id ?? 'new'` from the parent so opening
 * for a different item remounts a fresh form (initial state is derived
 * from props at first render — no useEffect syncing required, which
 * keeps the React-19 lint rule happy).
 *
 * Submission re-validates through the shared `use-automation` hook,
 * which runs the Zod schema client-side before posting.
 */

export interface AutomationFormDialogProps {
  open: boolean;
  onClose: () => void;
  /** Undefined for Create. */
  item?: AutomationItem;
  /** Null when no active account is selected — dialog shows an empty state. */
  accountId: string | null;
  onSubmit: (
    draft: Pick<CreateAutomationInput, 'name' | 'input' | 'condition' | 'action'>,
  ) => Promise<unknown>;
  isSubmitting: boolean;
  error: unknown;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function AutomationFormDialog({
  open,
  onClose,
  item,
  accountId,
  onSubmit,
  isSubmitting,
  error,
}: AutomationFormDialogProps) {
  const isEdit = item !== undefined;

  // Initial state derives from props at mount. The parent uses `key`
  // on this component to remount when the edited item changes.
  const [name, setName] = useState<string>(item?.name ?? '');
  const [inputDraft, setInputDraft] = useState<InputDraft>(() =>
    inputDraftFromUnknown(item?.input),
  );
  const [actionDraft, setActionDraft] = useState<ActionDraft>(() =>
    actionDraftFromUnknown(item?.action),
  );
  const [conditionDraft, setConditionDraft] = useState<LeafDraft>(() =>
    leafDraftFromUnknown(item?.condition),
  );

  // Source for the condition is derived from the input draft at render
  // time — no state syncing effect. Symbol + timeframe are inherited
  // from the input fields; providerKind is locked to the input kind.
  const conditionSource = useMemo(() => {
    const providerKind = providerKindFor(inputDraft.kind);
    if (inputDraft.kind === 'time') {
      return { providerKind };
    }
    return {
      providerKind,
      symbol: inputDraft.symbol.trim() || undefined,
      timeframe: inputDraft.interval.trim() || undefined,
    };
  }, [inputDraft.kind, inputDraft.symbol, inputDraft.interval]);

  const validationError = useMemo<string | null>(() => {
    if (name.trim().length === 0) return 'Name is required';
    const input = inputDraftToZod(inputDraft);
    if (input === null) return 'Input params are incomplete';
    const action = actionDraftToZod(actionDraft);
    if (action === null) return 'Action params are incomplete';
    try {
      leafDraftToZod(conditionDraft, conditionSource);
    } catch (err) {
      return err instanceof Error ? err.message : 'Condition is invalid';
    }
    return null;
  }, [name, inputDraft, actionDraft, conditionDraft, conditionSource]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (validationError !== null) return;
    const input = inputDraftToZod(inputDraft);
    const action = actionDraftToZod(actionDraft);
    const condition = leafDraftToZod(conditionDraft, conditionSource);
    if (input === null || action === null) return;
    try {
      // Casts: the draft helpers produce Zod-compatible shapes (validated
      // client-side by the shared schema on submit, server-side at the
      // controller). TS can't narrow the Record<string, unknown> union
      // through the discriminated union mechanically.
      await onSubmit({
        name: name.trim(),
        input: input as CreateAutomationInput['input'],
        condition: condition as CreateAutomationInput['condition'],
        action: action as CreateAutomationInput['action'],
      });
      onClose();
    } catch {
      // surfaced via `error` prop
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit automation rule' : 'New automation rule'}</DialogTitle>
          <DialogDescription>
            {accountId === null
              ? 'No active account selected.'
              : <>Pick an input kind, configure its params, set a condition, and choose an action. Account: <span className="font-mono">{accountId}</span></>}
          </DialogDescription>
        </DialogHeader>
        {accountId === null ? (
          <NoAccountEmptyState onClose={onClose} />
        ) : (
        <form onSubmit={handleSubmit} className="grid gap-5">
          <div>
            <Label htmlFor="rule-name">Name</Label>
            <Input
              id="rule-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Hourly S/R bounce"
            />
          </div>

          <fieldset className="grid gap-2">
            <legend className="text-xs uppercase tracking-wide text-muted-foreground">
              Input
            </legend>
            <div>
              <Label htmlFor="input-kind">Kind</Label>
              <Select
                value={inputDraft.kind}
                onValueChange={(v: string | null) =>
                  setInputDraft({
                    ...inputDraft,
                    kind: (v as InputKind) ?? 'time',
                  })
                }
              >
                <SelectTrigger id="input-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="time">time — cron trigger</SelectItem>
                  <SelectItem value="supportResistance">
                    supportResistance — S/R zones
                  </SelectItem>
                  <SelectItem value="rsiEmaWave">rsiEmaWave — RSI/EMA wave</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <InputKindFields value={inputDraft} onChange={setInputDraft} />
          </fieldset>

          <fieldset className="grid gap-2">
            <legend className="text-xs uppercase tracking-wide text-muted-foreground">
              Condition
            </legend>
            <ConditionEditor
              value={conditionDraft}
              onChange={setConditionDraft}
              providerKind={conditionSource.providerKind}
              defaultSymbol={conditionSource.symbol ?? ''}
              defaultTimeframe={conditionSource.timeframe ?? ''}
            />
          </fieldset>

          <fieldset className="grid gap-2">
            <legend className="text-xs uppercase tracking-wide text-muted-foreground">
              Action
            </legend>
            <ActionFields value={actionDraft} onChange={setActionDraft} />
          </fieldset>

          {error !== null && error !== undefined && (
            <p className="text-sm text-destructive">{errorMessage(error)}</p>
          )}
          {validationError !== null && (
            <p className="text-xs text-muted-foreground">{validationError}</p>
          )}

          <DialogFooter>
            <Button
              type="submit"
              disabled={isSubmitting || validationError !== null}
            >
              {isSubmitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create rule'}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
          </DialogFooter>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Inline empty state shown inside the dialog when no active account is
 * selected. Keeps the dialog reachable (the button isn't gated) and
 * guides the user to /accounts instead of dead-ending on a 4xx submit.
 */
function NoAccountEmptyState({ onClose }: { onClose: () => void }) {
  return (
    <div className="grid gap-4">
      <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-6 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Pick an account first</p>
        <p className="mt-1 text-xs">
          Automation rules are scoped to an account. Create one on the Accounts
          page, then come back to author it.
        </p>
      </div>
      <DialogFooter>
        <Link href="/accounts">
          <Button type="button">Create an account</Button>
        </Link>
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </div>
  );
}