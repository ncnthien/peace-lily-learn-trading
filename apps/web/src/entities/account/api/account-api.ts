/**
 * Account CRUD — pure HTTP calls (no React Query, no UI). The data hooks
 * in `model/use-accounts.ts` compose these with `useMutation` /
 * `useQueryClient`.
 */
import { apiDelete, apiPatch, apiPost } from '@/shared/lib/http';
import type { AccountRecord } from '../model/types';

export async function createAccount(payload: {
  name: string;
  type: 'real' | 'demo';
  balance?: number;
}): Promise<AccountRecord> {
  return apiPost<AccountRecord>('/accounts', payload);
}

export async function updateAccount(
  id: string,
  patch: { name?: string; status?: 'active' | 'disabled' },
): Promise<AccountRecord> {
  return apiPatch<AccountRecord>(`/accounts/${id}`, patch);
}

export async function deleteAccount(id: string): Promise<void> {
  return apiDelete(`/accounts/${id}`);
}
