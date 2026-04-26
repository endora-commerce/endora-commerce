/**
 * Server-side mutation wrapper for the storefront (T150–T155 / FR-039+).
 *
 * Mirrors `apiGet` but for POST/PATCH/DELETE. The wrapper:
 *   - threads the active Sales Channel + locale through every request via
 *     the same headers as `apiGet`.
 *   - forwards the caller's `b2b_session` cookie so authenticated mutations
 *     reach the backend with the right identity.
 *   - returns parsed JSON plus the raw `Set-Cookie` header so server actions
 *     can rotate the session cookie after login / logout.
 *   - converts the standard error envelope to `StorefrontApiError` so server
 *     actions can render a typed error message instead of crashing.
 */

import type { RequestContext } from './client';
import { StorefrontApiError } from './client';

const baseUrl = process.env['BACKEND_BASE_URL'] ?? 'http://localhost:3001';

export interface MutateOptions {
  method: 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  path: string;
  body?: unknown;
  ctx?: RequestContext;
  /** Raw value of the `b2b_session` cookie to forward to the backend. */
  sessionCookie?: string | null;
  /**
   * Pre-built `Cookie` header value for endpoints that need more than the
   * session cookie (e.g. cart endpoints which can carry `b2b_cart_anon`).
   * Wins over `sessionCookie` when both are supplied.
   */
  rawCookieHeader?: string | null;
}

export interface MutateResult<T> {
  /** Parsed `data` payload. `null` for 204 No Content. */
  data: T | null;
  status: number;
  /** Raw Set-Cookie header value(s) returned by the backend, if any. */
  setCookie: string[];
}

export async function apiMutate<T>(opts: MutateOptions): Promise<MutateResult<T>> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.ctx?.salesChannelCode) headers['X-Sales-Channel'] = opts.ctx.salesChannelCode;
  if (opts.ctx?.locale) headers['Accept-Language'] = opts.ctx.locale;
  if (opts.rawCookieHeader) {
    headers['Cookie'] = opts.rawCookieHeader;
  } else if (opts.sessionCookie) {
    headers['Cookie'] = `b2b_session=${opts.sessionCookie}`;
  }

  const init: RequestInit = {
    method: opts.method,
    headers,
    cache: 'no-store',
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  };

  const response = await fetch(`${baseUrl}${opts.path}`, init);
  const setCookie = collectSetCookie(response.headers);

  if (response.status === 204) {
    return { data: null, status: 204, setCookie };
  }

  if (!response.ok) {
    const envelope = (await response.json().catch(() => null)) as
      | { error: { code: string; message: string; requestId?: string } }
      | null;
    if (envelope?.error) {
      throw new StorefrontApiError(
        response.status,
        envelope.error.code,
        envelope.error.message,
        envelope.error.requestId,
      );
    }
    throw new StorefrontApiError(response.status, 'INTERNAL', `HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { data: T };
  return { data: payload.data, status: response.status, setCookie };
}

/**
 * GET that forwards a session cookie. Used by the account/organization
 * pages to reach `requireCustomer`-gated endpoints with the caller's
 * identity. We can't reuse `apiGet` because its cache plumbing assumes
 * unauthenticated, public reads.
 */
export async function apiGetAuthed<T>(opts: {
  path: string;
  sessionCookie: string;
  ctx?: RequestContext;
}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Cookie: `b2b_session=${opts.sessionCookie}`,
  };
  if (opts.ctx?.salesChannelCode) headers['X-Sales-Channel'] = opts.ctx.salesChannelCode;
  if (opts.ctx?.locale) headers['Accept-Language'] = opts.ctx.locale;

  const response = await fetch(`${baseUrl}${opts.path}`, {
    method: 'GET',
    headers,
    cache: 'no-store',
  });
  if (!response.ok) {
    const envelope = (await response.json().catch(() => null)) as
      | { error: { code: string; message: string; requestId?: string } }
      | null;
    if (envelope?.error) {
      throw new StorefrontApiError(
        response.status,
        envelope.error.code,
        envelope.error.message,
        envelope.error.requestId,
      );
    }
    throw new StorefrontApiError(response.status, 'INTERNAL', `HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { data: T };
  return payload.data;
}

function collectSetCookie(headers: Headers): string[] {
  const getSetCookie = (
    headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie;
  if (typeof getSetCookie === 'function') {
    return getSetCookie.call(headers);
  }
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

/**
 * Pull the `b2b_session` value out of one of the Set-Cookie strings the
 * backend returned. Returns `null` if no session cookie was set.
 */
export function extractSessionCookieValue(setCookie: string[]): string | null {
  for (const header of setCookie) {
    const match = /(?:^|;\s*)?b2b_session=([^;]+)/.exec(header);
    if (match) return match[1] ?? null;
  }
  return null;
}
