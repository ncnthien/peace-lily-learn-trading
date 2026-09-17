// ============================================================
// API client — two roles:
//   1. Generic HTTP helpers (apiGet / apiPost / apiPatch / apiPut /
//      apiDelete) used by the GET fetchers and mutations in
//      apps/web/src/hooks/*. Each hook owns its own GET fetcher so the
//      fetcher and its React Query consumer live together.
//   2. Domain types and mutation helpers (create/update/delete) that
//      the hooks layer calls from inside useMutation.
// ============================================================

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// ----- Generic HTTP helpers -----

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function safeErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string | string[] };
    if (Array.isArray(body.message)) return body.message.join(', ');
    return body.message ?? `API error ${res.status}`;
  } catch {
    return `API error ${res.status}`;
  }
}

async function ensureOk(res: Response): Promise<void> {
  if (!res.ok) {
    const message = await safeErrorMessage(res);
    throw new ApiError(res.status, message);
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: 'no-store' });
  await ensureOk(res);
  return (await res.json()) as T;
}

export async function apiPost<TResponse, TBody = unknown>(
  path: string,
  body: TBody,
): Promise<TResponse> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  await ensureOk(res);
  return (await res.json()) as TResponse;
}

export async function apiPatch<TResponse, TBody = unknown>(
  path: string,
  body: TBody,
): Promise<TResponse> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  await ensureOk(res);
  return (await res.json()) as TResponse;
}

export async function apiPut<TBody = unknown>(path: string, body: TBody): Promise<void> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  await ensureOk(res);
}

export async function apiDelete(path: string): Promise<void> {
  const res = await fetch(`${API_URL}${path}`, { method: 'DELETE' });
  await ensureOk(res);
}

// ----- Domain types -----

export interface PositionBoxRecord {
  id: string;
  symbol: string;
  interval: string;
  side: 'long' | 'short';
  entryOpenTime: number;
  bars: number;
  entryPrice: number;
  stopPrice: number;
  tpPrice: number;
}

export interface SRLineRecord {
  id: string;
  symbol: string;
  interval: string;
  kind: 'support' | 'resistance';
  price: number;
}

// ============================================================
// NCN-8: Accounts CRUD mutations (GET lives in hooks/use-accounts.ts)
// ============================================================

export interface AccountRecord {
  id: string;
  name: string;
  type: 'real' | 'demo';
  balance: number;
  status: 'active' | 'disabled';
  createdAt: string;
  updatedAt: string;
}

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

// ============================================================
// NCN-12 + NCN-27: Automation items domain types.
// GET lives in hooks/use-automation.ts; no mutations yet (NCN-18+).
// ============================================================

export interface AutomationInput {
  kind: string;
  [key: string]: unknown;
}

export type ConditionSource = {
  providerKind: string;
  timeframe?: string;
  symbol?: string;
};

export type LeafCondition =
  | { type: 'rsi_above'; threshold: number; source: ConditionSource }
  | { type: 'rsi_below'; threshold: number; source: ConditionSource }
  | { type: 'wave_direction'; direction: 'up' | 'down'; source: ConditionSource }
  | {
      type: 'wave_contained_in';
      timeRange: { start: number; end: number };
      source: ConditionSource;
    }
  | {
      type: 'wave_phase_not';
      phase: 'forming' | 'developing' | 'exhausting';
      source: ConditionSource;
    }
  | { type: string; [key: string]: unknown };

export type ConditionNode =
  | LeafCondition
  | { operator: 'and' | 'or'; children: ConditionNode[] };

export interface AutomationItem {
  id: string;
  accountId: string;
  name: string;
  input: AutomationInput;
  condition: ConditionNode;
  action: unknown;
  output: unknown;
  status: 'enabled' | 'disabled' | 'paused';
  createdAt: string;
  updatedAt: string;
}
