// src/lib/csrfClient.ts
'use client';

/** Reads the double-submit CSRF cookie (deliberately not httpOnly). */
export function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)cp_csrf=([^;]+)/);
  return match?.[1] ?? '';
}

/**
 * A single in-flight refresh, shared by every caller.
 *
 * Without this, a page with four pending requests fires four refreshes. Each
 * rotates the token; three then present an already-consumed one, which reuse
 * detection correctly treats as a stolen token and revokes the entire family.
 * The user is logged out for making four requests at once.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshOnce(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'x-csrf-token': csrfToken() },
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      // Cleared after the microtask so concurrent callers share THIS attempt
      // rather than starting another.
      setTimeout(() => { refreshInFlight = null; }, 0);
    }
  })();
  return refreshInFlight;
}

/**
 * Runs a request, and on 401 refreshes once and replays it.
 *
 * Exactly once. A refresh loop against a genuinely dead session is worse than
 * a clear error — it hammers the server and leaves the user staring at a
 * spinner instead of a login page.
 */
async function withRefresh(run: () => Promise<Response>): Promise<Response> {
  let res = await run();
  if (res.status !== 401) return res;

  const refreshed = await refreshOnce();
  if (!refreshed) {
    // The session is genuinely gone. Send them to sign in rather than
    // surfacing a misleading "network error".
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
    return res;
  }

  res = await run();
  return res;
}

export async function apiPost<T>(url: string, body: unknown): Promise<T> {
  const res = await withRefresh(() => fetch(url, {
    method: 'POST',
    // Read the token inside the closure: a refresh rotates it, and the replay
    // must use the NEW one.
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken() },
    body: JSON.stringify(body),
  }));
  const json = await res.json();
  if (!res.ok || !json.ok) throw new ApiError(json?.error?.code ?? 'UNKNOWN', json?.error?.message ?? 'Request failed');
  return json.data as T;
}

export async function apiPatch<T>(url: string, body: unknown): Promise<T> {
  const res = await withRefresh(() => fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken() },
    body: JSON.stringify(body),
  }));
  const json = await res.json();
  if (!res.ok || !json.ok) throw new ApiError(json?.error?.code ?? 'UNKNOWN', json?.error?.message ?? 'Request failed');
  return json.data as T;
}

export class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}
