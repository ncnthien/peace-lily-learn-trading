/**
 * Generic HTTP client used by every entity's data hooks.
 *
 * Business-agnostic: no domain types, no fetchers, just `apiGet` / `apiPost`
 * / `apiPatch` / `apiPut` / `apiDelete` plus an `ApiError`. Lives in `shared/`
 * because every layer above (`entities/`, `widgets/`, `views/`) can reach
 * it but it must never reach back into them.
 *
 * Axios replaces the previous `fetch`-based implementation. The public
 * API (`apiGet` / `apiPost` / `apiPatch` / `apiPut` / `apiDelete` +
 * `ApiError`) is identical, so call sites in `entities/*` did not need
 * to change. The shared `axios` instance is configured once below.
 */

import axios, { AxiosError, type AxiosInstance, type AxiosResponse } from 'axios';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function messageFromAxiosError(err: AxiosError): string {
  // The NestJS validation/error pipe returns `{ message: string | string[] }`.
  const data = err.response?.data as { message?: string | string[] } | undefined;
  if (data?.message !== undefined) {
    return Array.isArray(data.message) ? data.message.join(', ') : data.message;
  }
  return err.message || `API error ${err.response?.status ?? 'unknown'}`;
}

const client: AxiosInstance = axios.create({
  baseURL: API_URL,
  // Equivalent of the previous `cache: 'no-store'`: do not let the
  // browser serve a cached response to a mutating/GET pair that the
  // entity layer explicitly asks for fresh data.
  headers: { 'Content-Type': 'application/json' },
});

client.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error)) {
      throw new ApiError(error.response?.status ?? 0, messageFromAxiosError(error));
    }
    throw error;
  },
);

export async function apiGet<T>(path: string): Promise<T> {
  const res = await client.get<T>(path);
  return res.data;
}

export async function apiPost<TResponse, TBody = unknown>(
  path: string,
  body: TBody,
): Promise<TResponse> {
  const res = await client.post<TResponse>(path, body);
  return res.data;
}

export async function apiPatch<TResponse, TBody = unknown>(
  path: string,
  body: TBody,
): Promise<TResponse> {
  const res = await client.patch<TResponse>(path, body);
  return res.data;
}

export async function apiPut<TBody = unknown>(path: string, body: TBody): Promise<void> {
  await client.put(path, body);
}

export async function apiDelete(path: string): Promise<void> {
  await client.delete(path);
}
