'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';

import {
  createAccount,
  deleteAccount,
  fetchAccounts,
  updateAccount,
  type AccountRecord,
} from '@/lib/api';

export interface CreateAccountDraft {
  name: string;
  type: 'real' | 'demo';
  balance?: number;
}

export type UpdateAccountPatch = {
  name?: string;
  status?: 'active' | 'disabled';
};

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
    mutationFn: (draft: CreateAccountDraft) => createAccount(draft),
    onSuccess: invalidate,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateAccountPatch }) =>
      updateAccount(id, patch),
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
