import type {
  CandleWithIndicators,
  SignalDecision,
  SupportResistanceResult,
  Timeframe,
} from '@workspace/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export async function fetchIndicatorCandles(
  symbol: string,
  interval: Timeframe,
  limit = 200,
  endTime?: number,
): Promise<CandleWithIndicators[]> {
  const params = new URLSearchParams({
    symbol,
    interval,
    limit: String(limit),
  });
  if (endTime !== undefined) params.set('endTime', String(endTime));
  const res = await fetch(`${API_URL}/indicators/candles?${params}`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return (await res.json()) as CandleWithIndicators[];
}

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

export async function fetchPositionBoxes(
  symbol: string,
  interval: string,
): Promise<PositionBoxRecord[]> {
  const res = await fetch(
    `${API_URL}/position-boxes?symbol=${symbol}&interval=${interval}`,
    { cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return (await res.json()) as PositionBoxRecord[];
}

export async function createPositionBox(
  payload: Omit<PositionBoxRecord, 'id'>,
): Promise<PositionBoxRecord> {
  const res = await fetch(`${API_URL}/position-boxes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return (await res.json()) as PositionBoxRecord;
}

export async function updatePositionBox(
  id: string,
  patch: { entryPrice?: number; stopPrice?: number; tpPrice?: number; bars?: number },
): Promise<PositionBoxRecord> {
  const res = await fetch(`${API_URL}/position-boxes/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return (await res.json()) as PositionBoxRecord;
}

export async function deletePositionBox(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/position-boxes/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`API error ${res.status}`);
}

export interface SRLineRecord {
  id: string;
  symbol: string;
  interval: string;
  kind: 'support' | 'resistance';
  price: number;
}

export async function fetchSRLines(
  symbol: string,
  interval: string,
): Promise<SRLineRecord[]> {
  const res = await fetch(`${API_URL}/sr-lines?symbol=${symbol}&interval=${interval}`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return (await res.json()) as SRLineRecord[];
}

export async function createSRLine(payload: {
  symbol: string;
  interval: string;
  kind: 'support' | 'resistance';
  price: number;
}): Promise<SRLineRecord> {
  const res = await fetch(`${API_URL}/sr-lines`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return (await res.json()) as SRLineRecord;
}

export async function updateSRLine(
  id: string,
  price: number,
): Promise<SRLineRecord> {
  const res = await fetch(`${API_URL}/sr-lines/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ price }),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return (await res.json()) as SRLineRecord;
}

export async function deleteSRLine(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/sr-lines/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`API error ${res.status}`);
}

export async function fetchSrLevels(
  symbol: string,
  interval: Timeframe,
): Promise<SupportResistanceResult> {
  const res = await fetch(
    `${API_URL}/indicators/levels?symbol=${symbol}&interval=${interval}`,
    { cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return (await res.json()) as SupportResistanceResult;
}

export async function fetchSetting<T>(key: string): Promise<T | null> {
  const res = await fetch(`${API_URL}/settings/${key}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = (await res.json()) as { value: T | null };
  return data.value;
}

export async function updateSetting(key: string, value: unknown): Promise<void> {
  const res = await fetch(`${API_URL}/settings/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
}

export async function fetchLatestSignal(
  symbol: string,
  interval: Timeframe,
  limit = 200,
): Promise<SignalDecision> {
  const res = await fetch(
    `${API_URL}/signals/latest?symbol=${symbol}&interval=${interval}&limit=${limit}`,
    { cache: 'no-store' },
  );
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return (await res.json()) as SignalDecision;
}

// ============================================================
// NCN-8: Accounts CRUD client
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

export async function fetchAccounts(filter?: { type?: 'real' | 'demo' }): Promise<AccountRecord[]> {
  const params = new URLSearchParams();
  if (filter?.type !== undefined) params.set('type', filter.type);
  const qs = params.toString();
  const res = await fetch(`${API_URL}/accounts${qs !== '' ? `?${qs}` : ''}`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return (await res.json()) as AccountRecord[];
}

export async function createAccount(payload: {
  name: string;
  type: 'real' | 'demo';
  balance?: number;
}): Promise<AccountRecord> {
  const res = await fetch(`${API_URL}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const message = await safeErrorMessage(res);
    throw new Error(message);
  }
  return (await res.json()) as AccountRecord;
}

export async function updateAccount(
  id: string,
  patch: { name?: string; status?: 'active' | 'disabled' },
): Promise<AccountRecord> {
  const res = await fetch(`${API_URL}/accounts/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const message = await safeErrorMessage(res);
    throw new Error(message);
  }
  return (await res.json()) as AccountRecord;
}

export async function deleteAccount(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/accounts/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const message = await safeErrorMessage(res);
    throw new Error(message);
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

// ============================================================
// NCN-12: Automation items client
// ============================================================

export interface AutomationInput {
  kind: string;
  [key: string]: unknown;
}

export interface AutomationItem {
  id: string;
  accountId: string;
  name: string;
  input: AutomationInput;
  conditions: unknown[];
  action: unknown;
  output: unknown;
  status: 'enabled' | 'disabled' | 'paused';
  createdAt: string;
  updatedAt: string;
}

export async function fetchAutomationItems(filter?: { accountId?: string }): Promise<AutomationItem[]> {
  const params = new URLSearchParams();
  if (filter?.accountId !== undefined) params.set('accountId', filter.accountId);
  const qs = params.toString();
  const res = await fetch(`${API_URL}/automation${qs !== '' ? `?${qs}` : ''}`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return (await res.json()) as AutomationItem[];
}
