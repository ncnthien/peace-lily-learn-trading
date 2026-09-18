'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import {
  CreateAccountDraftSchema,
  UpdateAccountPatchSchema,
  type CreateAccountDraft,
  type UpdateAccountPatch,
} from '@workspace/shared';
import { ZodError } from 'zod';

import {
  apiGet,
  createAccount,
  deleteAccount,
  updateAccount,
  type AccountRecord,
} from '@/lib/api';

/**
 * Thin client-side guards. The server is still the source of truth
 * (ZodValidationPipe at the controller boundary rejects the same bad
 * inputs as 400 Bad Request). These wrappers exist so bad inputs fail
 * at the call site with a precise message instead of round-tripping to
 * the server and back.
 */
function parseOrThrow<T>(schema: { parse: (v: unknown) => T }, value: unknown, label: string): T {
  try {
    return schema.parse(value);
  } catch (err) {
    if (err instanceof ZodError) {
      throw new Error(`${label}: ${err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
    }
    throw err;
  }
}

// ----- GET fetcher (local to this hook) -----

export async function fetchAccounts(
  filter?: { type?: 'real' | 'demo' },
): Promise<AccountRecord[]> {
  const params = new URLSearchParams();
  if (filter?.type !== undefined) params.set('type', filter.type);
  const qs = params.toString();
  return apiGet<AccountRecord[]>(`/accounts${qs !== '' ? `?${qs}` : ''}`);
}

// ----- Hook -----

export function useAccounts(filter?: { type?: 'real' | 'demo' }) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['accounts', filter ?? {}] as const, [filter]);

  const query = useQuery({
    queryKey,
    queryFn: () => fetchAccounts(filter),
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['accounts'] });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: (draft: CreateAccountDraft) =>
      createAccount(parseOrThrow(CreateAccountDraftSchema, draft, 'create account draft')),
    onSuccess: invalidate,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateAccountPatch }) =>
      updateAccount(
        id,
        parseOrThrow(UpdateAccountPatchSchema, patch, 'update account patch'),
      ),
    onSuccess: invalidate,
  });

  const update = useCallback(
    (id: string, patch: UpdateAccountPatch) =>
      updateMutation.mutateAsync({ id, patch }),
    [updateMutation],
  );

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAccount(id),
    onSuccess: invalidate,
  });

  return {
    accounts: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    create: createMutation.mutateAsync,
    update,
    remove: deleteMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    createError: createMutation.error,
    updateError: updateMutation.error,
    deleteError: deleteMutation.error,
  };
}

export type { AccountRecord };
