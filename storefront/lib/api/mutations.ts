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
import { backendBaseUrl } from '../env.mjs';

/**
 * The backend's origin, read per call.
 *
 * **Not a module-scope constant, and that is measured rather than stylistic.**
 * `BACKEND_BASE_URL` is a *run-time* value — `deploy/compose.prod.yml` sets it
 * on the container and `storefront/Dockerfile` deliberately does not pass it as
 * a build arg — but `next build`'s collect-page-data phase evaluates every
 * route's module scope, so a `const baseUrl = backendBaseUrl()` here made the
 * image build fail on `/sitemap.xml` and `/manifest.webmanifest` for a variable
 * that is correctly absent at that moment. Reading it inside the call is also
 * what `lib/api/backend-reachability.ts` does, for its own half of the same
 * reason: a container configured at start-up is only honoured by a read that
 * happens then.
 */


function throwFromErrorEnvelope(status: number, envelope: unknown): never {
  const err = (envelope as { error?: {
    code: string;
    message: string;
    requestId?: string;
    details?: Array<{ path: string; issue: string }> | Record<string, unknown>;
  } } | null)?.error;
  if (err) {
    let message = err.message;
    if (Array.isArray(err.details) && err.details.length > 0) {
      const hint = err.details
        .slice(0, 3)
        .map((d) => `${d.path || '(root)'}: ${d.issue}`)
        .join('; ');
      message = `${message} (${hint})`;
    }
    throw new StorefrontApiError(status, err.code, message, err.requestId);
  }
  throw new StorefrontApiError(status, 'INTERNAL', `HTTP ${status}`);
}

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
  /** Extra request headers to forward (e.g. `If-Match` for optimistic concurrency). */
  headers?: Record<string, string>;
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
  if (opts.headers) Object.assign(headers, opts.headers);

  const init: RequestInit = {
    method: opts.method,
    headers,
    cache: 'no-store',
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  };

  const response = await fetch(`${backendBaseUrl()}${opts.path}`, init);
  const setCookie = collectSetCookie(response.headers);

  if (response.status === 204) {
    return { data: null, status: 204, setCookie };
  }

  if (!response.ok) {
    const envelope = await response.json().catch(() => null);
    throwFromErrorEnvelope(response.status, envelope);
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

  const response = await fetch(`${backendBaseUrl()}${opts.path}`, {
    method: 'GET',
    headers,
    cache: 'no-store',
  });
  if (!response.ok) {
    const envelope = await response.json().catch(() => null);
    throwFromErrorEnvelope(response.status, envelope);
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
