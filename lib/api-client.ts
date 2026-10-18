/** Tiny typed wrapper around fetch for Client Components. */

export type ApiError = Error & { status?: number; details?: unknown };

export async function apiRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    const error = new Error(body?.error ?? `Error ${response.status}`) as ApiError;
    error.status = response.status;
    throw error;
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T>(url: string) => apiRequest<T>(url),
  post: <T>(url: string, body?: unknown) =>
    apiRequest<T>(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(url: string, body: unknown) =>
    apiRequest<T>(url, { method: 'PATCH', body: JSON.stringify(body) }),
  del: <T>(url: string) => apiRequest<T>(url, { method: 'DELETE' }),
};
