import type {
  BlogBySlugResponse,
  BlogIndexResponse,
  BlogTagByCodeResponse,
} from '@b2b/contracts';
import { apiGet, StorefrontApiError, type RequestContext } from './client';
import { isModuleDisabled } from './module-absence';

export type {
  BlogBySlugResponse,
  BlogIndexResponse,
  BlogTagByCodeResponse,
};

/**
 * Fetch the blog index payload (latest posts + first-level categories
 * + resolved url prefix) for the active channel + locale.
 */
export async function getBlogIndex(
  ctx: RequestContext,
): Promise<BlogIndexResponse | null> {
  try {
    // No Next Data Cache (apiGet falls back to `no-store`): blog content is
    // operator-driven and must reflect a publish immediately. The backend
    // already serves these reads from a short-TTL Redis cache that is
    // invalidated on every post/category write, so skipping the storefront-side
    // time cache keeps the list fresh without a per-request DB hit. A 60s/300s
    // Next cache previously hid newly published posts until it expired.
    const res = await apiGet<{ data: BlogIndexResponse }>('/api/v1/blog/by-channel', ctx);
    return res.data;
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 404) return null;
    // Feature 073 — a switched-off `blog` is an absence, not an error. Before
    // this, every non-404 was rethrown, so gating the module produced a render
    // error on any page that links the blog rather than the module quietly
    // disappearing.
    if (isModuleDisabled(err)) return null;
    throw err;
  }
}

/**
 * Resolve a single blog slug to either a Category (with paginated posts)
 * or a Post. Returns null on 404 so the caller renders a 404 instead of
 * throwing.
 */
export async function getBlogBySlug(
  slug: string,
  ctx: RequestContext,
  page: number | undefined,
): Promise<BlogBySlugResponse | null> {
  const qs = new URLSearchParams({ slug });
  if (page !== undefined) qs.set('page', String(page));
  try {
    // Always-fresh (see getBlogIndex) — the backend Redis cache handles perf.
    const res = await apiGet<{ data: BlogBySlugResponse }>(
      `/api/v1/blog/by-slug?${qs.toString()}`,
      ctx,
    );
    return res.data;
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Fetch the paginated tag view payload for `<prefix>/tag/<code>`.
 */
export async function getBlogTagByCode(
  code: string,
  ctx: RequestContext,
  page: number | undefined,
): Promise<BlogTagByCodeResponse | null> {
  const qs = new URLSearchParams({ code });
  if (page !== undefined) qs.set('page', String(page));
  try {
    // Always-fresh (see getBlogIndex) — the backend Redis cache handles perf.
    const res = await apiGet<{ data: BlogTagByCodeResponse }>(
      `/api/v1/blog/tag-by-code?${qs.toString()}`,
      ctx,
    );
    return res.data;
  } catch (err) {
    if (err instanceof StorefrontApiError && err.status === 404) return null;
    throw err;
  }
}
