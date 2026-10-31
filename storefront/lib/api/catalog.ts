import { CATALOG_PRODUCT_STOREFRONT_CACHE_TAGS } from '@endora-commerce/contracts';
import type {
  CategoryNode,
  CategoryPageContent,
  FilterDefinition,
  Pagination,
  ProductDetail,
  ProductKeyResolution,
  ProductListCapabilities,
  ProductListSort,
  ProductSummary,
} from '@endora-commerce/contracts';
import { apiGet, apiGetForViewer, type RequestContext } from './client';

/**
 * Catalog read paths. The API returns a Zod-derived shape; we re-export
 * those types from `@endora-commerce/contracts` so themes that only override
 * `components/*` keep the same prop contracts.
 *
 * The three readers that carry a **price** — the listing, the product detail
 * and the cross-sell tiles — go through `apiGetForViewer` (issue #265). The
 * backend has priced those three for the caller since MR !796; the storefront
 * forwarded no credential, so every buyer was quoted the channel price and the
 * ruling never reached the shop. `getCategoryTree` and `getFilters` carry no
 * price and stay anonymous and shared.
 *
 * The same three carry the shopper's currency as `?currency=` (issue #249) —
 * see {@link setCurrency}.
 */

/**
 * Add the shopper's selected currency to a priced catalogue read.
 *
 * A query parameter, not a header: the Data Cache keys a `fetch` by its URL,
 * so each currency is its own entry, and a visitor who chose nothing asks the
 * URL — and lands on the entry — they always did. Only a well-formed code is
 * forwarded: the backend refuses a malformed one with a 400, and a tampered
 * cookie must not turn every catalogue page into an error. A code the channel
 * does not offer is the backend's to answer, in the channel's default.
 */
function setCurrency(params: URLSearchParams, ctx: RequestContext): void {
  if (ctx.currency && /^[A-Za-z]{3}$/.test(ctx.currency)) {
    params.set('currency', ctx.currency.toUpperCase());
  }
}

/** `path` with `params` appended, or `path` alone when there are none. */
function withQuery(path: string, params: URLSearchParams): string {
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export interface ListProductsResponse {
  data: ProductSummary[];
  /**
   * The published contract's type and not a local copy of it. This used to be
   * declared by hand with a `nextCursor` the API has never sent — the field is
   * `cursor` — so every reader was handed `undefined`: no listing offered a
   * second page and the sitemap asked for the first page until it gave up.
   * Deriving it is what turns the next such drift into a compile error.
   */
  pagination: Pagination;
  /**
   * Feature 086 — what this page may offer this viewer. Absent from an older
   * backend, which is why the toolbar treats `undefined` as "no price
   * controls": offering an ordering the API refuses is worse than offering
   * none.
   */
  capabilities?: ProductListCapabilities;
}

export interface ListProductsQuery {
  q?: string | undefined;
  /**
   * Issue #590 — only these products (`?ids=`, at most `PRODUCT_LIST_MAX_IDS`).
   * The answer is the subset the viewer may see, in the listing's order.
   */
  ids?: readonly string[] | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
  sort?: ProductListSort | undefined;
  categorySlug?: string | undefined;
  attributeFilters?: Record<string, string[]> | undefined;
  /** Feature 086 — inclusive bounds on the viewer's own price. */
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
}

export async function listProducts(
  query: ListProductsQuery,
  ctx: RequestContext,
): Promise<ListProductsResponse> {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.ids && query.ids.length > 0) params.set('ids', query.ids.join(','));
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit) params.set('limit', String(query.limit));
  if (query.sort) params.set('sort', query.sort);
  // Pass-through, and deliberately no change to the `apiGetForViewer` split
  // below: that split is what stops one buyer's ordering being stored under a
  // key every other buyer's request also computes (FR-018).
  if (query.minPrice !== undefined) params.set('minPrice', String(query.minPrice));
  if (query.maxPrice !== undefined) params.set('maxPrice', String(query.maxPrice));
  if (query.categorySlug) params.set('filter[category]', query.categorySlug);
  if (query.attributeFilters) {
    for (const [key, values] of Object.entries(query.attributeFilters)) {
      for (const value of values) {
        params.append(`filter[attr.${key}]`, value);
      }
    }
  }
  setCurrency(params, ctx);
  return apiGetForViewer<ListProductsResponse>(
    withQuery('/api/v1/catalog/products', params),
    ctx,
    { revalidate: 60, tags: ['catalog:products'] },
  );
}

export async function getProductBySlug(
  slug: string,
  ctx: RequestContext,
): Promise<ProductDetail> {
  const params = new URLSearchParams();
  setCurrency(params, ctx);
  const res = await apiGetForViewer<{ data: ProductDetail }>(
    withQuery(`/api/v1/catalog/products/${encodeURIComponent(slug)}`, params),
    ctx,
    { revalidate: 60, tags: productCacheTags(slug) },
  );
  return res.data;
}

/**
 * Feature 163 (checkpoint E security review, I4; T155 finding CACHE-1) — a product
 * read's cache tags: the shared tag, and the per-key tag of the key it was asked by
 * while it fits Next's tag limit (the key comes from the URL, so it can be any length).
 * `catalog` drops a product's per-key tags — its id, slug, URL keys and former keys —
 * after every write that can change whether or where it is available
 * (`CATALOG_PRODUCT_STOREFRONT_CACHE_TAGS`): Next keeps only a `200`, so the time-based
 * window alone would go on serving a product that has since become unavailable.
 */
export function productCacheTags(key: string, shared: string = CATALOG_PRODUCT_STOREFRONT_CACHE_TAGS.product): string[] {
  const keyed = CATALOG_PRODUCT_STOREFRONT_CACHE_TAGS.productKey(key);
  return keyed.length <= CATALOG_PRODUCT_STOREFRONT_CACHE_TAGS.maxLength ? [shared, keyed] : [shared];
}

/**
 * Feature 163 (`specs/163-product-data-scopes/contracts/url-keys-and-redirects.md`
 * §4) — which product the key a product page was opened by names at the
 * request's channel and language, or the path it redirects to.
 *
 * Asked as the viewer: the answer depends on who may see the product (an
 * unavailable one is not found, for a redirect too), so a signed-in buyer's
 * answer never enters the shared Data Cache — `apiGetForViewer`'s rule, as for
 * the product read it precedes. A redirect is answered `200` with
 * `kind: 'redirect'`; the page turns it into a permanent redirect.
 */
export async function resolveProductKey(
  key: string,
  ctx: RequestContext,
): Promise<ProductKeyResolution> {
  const res = await apiGetForViewer<{ data: ProductKeyResolution }>(
    `/api/v1/catalog/products/resolve/${encodeURIComponent(key)}`,
    ctx,
    { revalidate: 60, tags: productCacheTags(key) },
  );
  return res.data;
}

/** Feature 155 — the most product reads `getProductMinimumsBySlugs` makes (the draft's 200 lines). */
export const DRAFT_MINIMUM_MAX_SLUGS = 200;

/**
 * Feature 155 (FR-032, research R15) — the current pieces minimum of each product, by slug,
 * read through the existing public product detail (no new route). For the quote-request
 * draft page, whose lines live in `localStorage` and may predate a minimum (US4 #14).
 *
 * Threat S8: distinct non-empty slugs only, at most {@link DRAFT_MINIMUM_MAX_SLUGS}, at most
 * `concurrency` reads in flight (the `getResolvedPricesBulk` pattern). Plan I5: any failure —
 * a 404 for a product the buyer may not see, a 5xx, the network — leaves the slug out ("minimum
 * unknown"); it never fails the whole read. `null` = the product has no minimum.
 *
 * A plain object, not a `Map`, because a server action hands it to the browser.
 */
export async function getProductMinimumsBySlugs(
  slugs: readonly unknown[],
  ctx: RequestContext,
  concurrency = 8,
): Promise<Record<string, number | null>> {
  const distinct = [
    ...new Set(
      slugs
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
  ].slice(0, DRAFT_MINIMUM_MAX_SLUGS);
  const out: Record<string, number | null> = {};
  const queue = [...distinct];
  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const slug = queue.shift();
      if (slug === undefined) return;
      try {
        const product = await getProductBySlug(slug, ctx);
        const minimum = product.minOrderQuantity;
        out[slug] = typeof minimum === 'number' && minimum > 1 ? minimum : null;
      } catch {
        // Minimum unknown: the API refusal at submission stays the binding rule.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, distinct.length) }, worker));
  return out;
}

/**
 * Feature 002 US4 — public Product Links read for cart cross-sell.
 * Returns the storefront-shape link summaries (drops archived /
 * channel-restricted targets server-side). Empty array when product
 * has no links of the requested kind.
 */
export async function getProductLinks(
  productIdOrSlug: string,
  kind: 'related' | 'up_sell' | 'cross_sell',
  ctx: RequestContext,
): Promise<
  Array<{
    id: string;
    kind: 'related' | 'up_sell' | 'cross_sell';
    position: number;
    product: {
      id: string;
      sku: string;
      slug: string;
      name: string;
      primaryAssetUrl: string | null;
      price: { amount: number; currency: string } | null;
    };
  }>
> {
  const linkParams = new URLSearchParams({ kind });
  setCurrency(linkParams, ctx);
  try {
    const res = await apiGetForViewer<{
      data: Array<{
        id: string;
        kind: 'related' | 'up_sell' | 'cross_sell';
        position: number;
        product: {
          id: string;
          sku: string;
          slug: string;
          name: string;
          primaryAssetUrl: string | null;
          price: { amount: number; currency: string } | null;
        };
      }>;
    }>(
      withQuery(`/api/v1/catalog/products/${encodeURIComponent(productIdOrSlug)}/links`, linkParams),
      ctx,
      { revalidate: 60, tags: productCacheTags(productIdOrSlug, 'catalog:links') },
    );
    return res.data;
  } catch {
    // Cart cross-sell is decorative — silently degrade if the lookup fails
    // so a flaky public links endpoint can't break the whole cart page.
    return [];
  }
}

export async function getCategoryTree(ctx: RequestContext): Promise<CategoryNode[]> {
  const res = await apiGet<{ data: CategoryNode[] }>(
    '/api/v1/catalog/categories',
    ctx,
    { revalidate: 300, tags: ['catalog:categories'] },
  );
  return res.data;
}

/**
 * The Page Builder document an operator authored for one category's page,
 * resolved by the backend to the caller's language.
 *
 * Under the tag the tree is under, on purpose: the backend flushes
 * `catalog:categories` on every category write, the content save included, so
 * an operator's edit is visible on the next request rather than five minutes
 * later, and there is no second tag for anybody to forget.
 *
 * **A failed read is "no content", not a failed page.** The document is an
 * addition to a product listing; a category whose content could not be read
 * must still sell its products. Anonymous and shared like the tree: the
 * document carries no price and nothing about the viewer.
 */
export async function getCategoryPageContent(
  categoryId: string,
  ctx: RequestContext,
): Promise<CategoryPageContent> {
  try {
    const res = await apiGet<{ data: CategoryPageContent }>(
      `/api/v1/catalog/categories/${encodeURIComponent(categoryId)}/content`,
      ctx,
      { revalidate: 300, tags: ['catalog:categories'] },
    );
    return res.data;
  } catch {
    return { categoryId, language: null, content: null };
  }
}

export async function getFilters(ctx: RequestContext): Promise<FilterDefinition[]> {
  const res = await apiGet<{ data: FilterDefinition[] }>(
    '/api/v1/catalog/filters',
    ctx,
    { revalidate: 300, tags: ['catalog:filters'] },
  );
  return res.data;
}
