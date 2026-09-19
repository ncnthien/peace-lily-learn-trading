'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { ZodError } from 'zod';
import {
  CreateAutomationInputSchema,
  UpdateAutomationInputSchema,
  type CreateAutomationInput,
  type UpdateAutomationInput,
} from '@workspace/shared';
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  type AutomationItem,
} from '@/lib/api';

/**
 * Thin client-side guards. The server is still the source of truth
 * (ZodValidationPipe rejects bad inputs as 400). These wrappers exist
 * so bad inputs fail at the call site with a precise message instead
 * of round-tripping to the server and back.
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

// ----- GET fetcher -----

export async function fetchAutomationItems(
  filter?: { accountId?: string },
): Promise<AutomationItem[]> {
  const params = new URLSearchParams();
  if (filter?.accountId !== undefined) params.set('accountId', filter.accountId);
  const qs = params.toString();
  return apiGet<AutomationItem[]>(`/automation${qs !== '' ? `?${qs}` : ''}`);
}

async function fetchAutomationItem(id: string): Promise<AutomationItem> {
  return apiGet<AutomationItem>(`/automation/${id}`);
}

// ----- Hook -----

export function useAutomationItems(filter?: { accountId?: string }) {
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['automation', filter ?? {}] as const, [filter]);

  const query = useQuery({
    queryKey,
    queryFn: () => fetchAutomationItems(filter),
  });

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['automation'] });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: (draft: CreateAutomationInput) =>
      apiPost<AutomationItem, CreateAutomationInput>(
        '/automation',
        parseOrThrow(CreateAutomationInputSchema, draft, 'create automation rule'),
      ),
    onSuccess: invalidate,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateAutomationInput }) =>
      apiPatch<AutomationItem, UpdateAutomationInput>(
        `/automation/${id}`,
        parseOrThrow(UpdateAutomationInputSchema, patch, 'update automation patch'),
      ),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/automation/${id}`),
    onSuccess: invalidate,
  });

  const create = useCallback(
    (draft: CreateAutomationInput) => createMutation.mutateAsync(draft),
    [createMutation],
  );
  const update = useCallback(
    (id: string, patch: UpdateAutomationInput) =>
      updateMutation.mutateAsync({ id, patch }),
    [updateMutation],
  );
  const remove = useCallback((id: string) => deleteMutation.mutateAsync(id), [deleteMutation]);

  return {
    items: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    fetchById: fetchAutomationItem,
    create,
    update,
    remove,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending,
    createError: createMutation.error,
    updateError: updateMutation.error,
    deleteError: deleteMutation.error,
  };
}

export type { AutomationItem };