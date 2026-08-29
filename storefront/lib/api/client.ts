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
 *
 * `apiGet` forwards **no credential**, deliberately: its answers are public and
 * shared. A read whose answer depends on the buyer goes through
 * `apiGetForViewer`, which is the only function here that sends one.
 */

export interface RequestContext {
  /** Sales-channel code; backend defaults to the public one when undefined. */
  salesChannelCode?: string | undefined;
  /** Effective storefront locale, e.g. `en-US`. */
  locale?: string | undefined;
  /** Buyer-selected display currency (from the `currency` cookie), e.g. `EUR`. */
  currency?: string | undefined;
  /**
   * Raw `b2b_session` cookie value of the buyer in front of the page, or
   * `undefined` for a visitor with no session (issue #265).
   *
   * **Only {@link apiGetForViewer} reads it.** Every other reader stays
   * anonymous by construction, which is the property that keeps the crawler's
   * representation and the shared Data Cache entry the ones that shipped
   * before per-viewer pricing existed.
   */
  viewerSession?: string | undefined;
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

  return await send<T>(path, init);
}

/**
 * A GET whose answer depends on **who is asking** — today, every read that
 * carries a price (issue #265).
 *
 * Two shapes, and the split is the whole point:
 *
 *  - **No session** — delegates to {@link apiGet} verbatim. Same headers, same
 *    `next.revalidate`, same `tags`, so the anonymous request lands on exactly
 *    the shared Data Cache entry it landed on before this function existed.
 *    That entry is the crawler's representation and the storefront's 60 s
 *    window (Principle VII), and nothing here may move it.
 *  - **A session** — forwards the buyer's `b2b_session` cookie and sets
 *    `cache: 'no-store'`, with **no** `next` options at all. A negotiated
 *    figure resolved for one organisation must never enter a cache another
 *    caller can read, and Next's Data Cache is keyed on the URL, not on the
 *    credential: leaving `revalidate` set here would store one buyer's price
 *    under a key every other buyer's request also computes. The backend closes
 *    the same direction independently with `Cache-Control: private, no-store`
 *    (`markPersonalisedPricing`), so neither side is the only guard.
 *
 * Called from the server, not the browser: every storefront route is rendered
 * dynamically (`export const dynamic = 'force-dynamic'` in the root layout), so
 * there is no static or revalidated **page** to lose by resolving the price
 * during the render — and resolving it there is what keeps the buyer from
 * seeing the public figure first and their own a moment later.
 */
export async function apiGetForViewer<T>(
  path: string,
  ctx: RequestContext = {},
  options: FetchOptions = {},
): Promise<T> {
  if (!ctx.viewerSession) return await apiGet<T>(path, ctx, options);

  const headers: Record<string, string> = {
    Accept: 'application/json',
    Cookie: `b2b_session=${ctx.viewerSession}`,
  };
  if (ctx.salesChannelCode) headers['X-Sales-Channel'] = ctx.salesChannelCode;
  if (ctx.locale) headers['Accept-Language'] = ctx.locale;

  return await send<T>(path, { method: 'GET', headers, cache: 'no-store' });
}

/**
 * The same context with the buyer's credential dropped.
 *
 * For the reader that must stay the canonical public answer even on a page a
 * buyer is signed in to — `generateMetadata`, whose output is the crawler's and
 * the social card's, and which carries no price to personalise.
 */
export function withoutViewer(ctx: RequestContext): RequestContext {
  const { viewerSession: _viewerSession, ...rest } = ctx;
  return rest;
}

async function send<T>(
  path: string,
  init: RequestInit & { next?: { revalidate?: number | false; tags?: string[] } },
): Promise<T> {
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
