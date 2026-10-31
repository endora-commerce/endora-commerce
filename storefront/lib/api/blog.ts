import {
  PRODUCT_LIST_MAX_IDS,
  type BlogBySlugResponse,
  type BlogIndexResponse,
  type BlogPostCard,
  type BlogTagByCodeResponse,
  type ProductSummary,
} from '@endora-commerce/contracts';
import { listProducts } from './catalog';
import { apiGet, StorefrontApiError, type RequestContext } from './client';
import { isModuleDisabled } from './module-absence';
import type { ModulePresenceSet } from './module-presence';

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

/**
 * The newest published posts of the active channel as cards, optionally of
 * one category (feature 163, `GET /api/v1/blog/posts`) — what
 * `blog.LatestPosts` renders. Always fresh, as the other blog reads. An unknown
 * category is an empty list; a switched-off `blog` is an empty list too, as an
 * absence rather than an error.
 */
export async function listBlogPosts(
  query: { limit: number; categorySlug?: string },
  ctx: RequestContext,
): Promise<BlogPostCard[]> {
  const qs = new URLSearchParams({ limit: String(query.limit) });
  if (query.categorySlug) qs.set('categorySlug', query.categorySlug);
  try {
    const res = await apiGet<{ data: BlogPostCard[] }>(`/api/v1/blog/posts?${qs.toString()}`, ctx);
    return res.data;
  } catch (err) {
    if (isModuleDisabled(err)) return [];
    throw err;
  }
}

/**
 * A blog post's related products, as listing cards priced for the viewer —
 * issue #590.
 *
 * The post payload names them by id only (`relatedProductIds`): it is cached
 * per channel and language for every visitor, so it may carry nothing about
 * one. This is the read that may: **one** catalogue listing read restricted to
 * those ids (`?ids=`), through `listProducts` and so through `apiGetForViewer`,
 * the shopper's currency and the request's channel and language. That makes
 * each card exactly what a listing card is for this viewer — the products they
 * may see, at the price the pricing engine resolves for their organisation and
 * customer account, with the display mode that says net, gross or both — and a
 * signed-in buyer's answer is fetched `no-store`, never into the shared Data
 * Cache. Blog pages render per request (the root layout's `force-dynamic`), so
 * the answer is not stored in a page either.
 *
 * The post's order is kept; a product the listing did not answer — unknown,
 * deleted, out of the channel, hidden from this viewer — is left out. At most
 * `PRODUCT_LIST_MAX_IDS`, the first ones of the post.
 *
 * An absence, never an error: nothing is asked while `catalog` is not present
 * (Principle XVII — the presence the request resolved), a `MODULE_DISABLED`
 * answer is the same absence, and any other failure costs the post its strip
 * rather than the page, as a Page Builder product block does
 * (`lib/page-builder/block-data.ts`).
 */
export async function getBlogRelatedProducts(
  ids: readonly string[] | undefined,
  ctx: RequestContext,
  modules: Pick<ModulePresenceSet, 'isPresent'>,
): Promise<ProductSummary[]> {
  const named = [...new Set(ids ?? [])].slice(0, PRODUCT_LIST_MAX_IDS);
  if (named.length === 0 || !modules.isPresent('catalog')) return [];
  try {
    const { data } = await listProducts({ ids: named, limit: named.length }, ctx);
    const byId = new Map(data.map((product) => [product.id, product]));
    return named.flatMap((id) => {
      const product = byId.get(id);
      return product ? [product] : [];
    });
  } catch {
    // `MODULE_DISABLED` included: the strip is decorative, so every failure is its absence.
    return [];
  }
}
