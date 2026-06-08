/**
 * Server-side fetch wrapper for the storefront.
 *
 * Themes inherit this layer untouched and only customise `components/*`.
 * The wrapper:
 *   - reads `BACKEND_BASE_URL` from the environment, defaulting to
 *     http://localhost:3001 in dev.
 *   - threads the active Sales Channel + locale through every request via
 *     the `X-Sales-Channel` and `Accept-Language` headers, so server-side
 *     tenancy + i18n resolution stays in one place.
 *   - opts every fetch into Next's native cache machinery; pages choose
 *     `revalidate` per route per Principle VII (SSR for catalog/PDP).
 */

export interface RequestContext {
  /** Sales-channel code; backend defaults to the public one when undefined. */
  salesChannelCode?: string | undefined;
  /** Effective storefront locale, e.g. `en-US`. */
  locale?: string | undefined;
  /** Buyer-selected display currency (from the `currency` cookie), e.g. `EUR`. */
  currency?: string | undefined;
}

export interface FetchOptions {
  /** Next.js revalidate hint in seconds. `false` disables caching. */
  revalidate?: number | false;
  /** Tag the cache entry so it can be invalidated by name. */
  tags?: string[];
}

const baseUrl = process.env['BACKEND_BASE_URL'] ?? 'http://localhost:3001';

export class StorefrontApiError extends Error {
  readonly status: number;
  readonly code: string;
  /**
   * The backend's human-readable message *without* the `CODE: ` prefix that
   * `message` carries for logs. Use this when surfacing the error to end
   * users (e.g. the login form) so they don't see the raw error code.
   */
  readonly detail: string;
  readonly requestId?: string;

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(`${code}: ${message}`);
    this.status = status;
    this.code = code;
    this.detail = message;
    if (requestId !== undefined) this.requestId = requestId;
  }
}

export async function apiGet<T>(
  path: string,
  ctx: RequestContext = {},
  options: FetchOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (ctx.salesChannelCode) headers['X-Sales-Channel'] = ctx.salesChannelCode;
  if (ctx.locale) headers['Accept-Language'] = ctx.locale;

  const init: RequestInit & { next?: { revalidate?: number | false; tags?: string[] } } = {
    method: 'GET',
    headers,
  };
  if (options.revalidate !== undefined || options.tags) {
    init.next = {};
    if (options.revalidate !== undefined) init.next.revalidate = options.revalidate;
    if (options.tags) init.next.tags = options.tags;
  } else {
    init.cache = 'no-store';
  }

  const response = await fetch(`${baseUrl}${path}`, init);
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
  return (await response.json()) as T;
}
