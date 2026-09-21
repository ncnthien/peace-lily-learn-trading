'use client';

import type { CreateAccountDraft } from '@workspace/shared';
import { Button } from '@/shared/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/ui/card';
import { CreateForm, type AccountType } from './CreateForm';

/**
 * "Create a demo / real account" call-to-action card. Closed by default;
 * opening it reveals the inline `<CreateForm>`. The mutation is delegated
 * to the page-level `useAccounts().create` so loading / error states stay
 * in one place.
 */

export function CreateCta({
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
              variant="secondary"
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
