import type {
  CategoryNode,
  FilterDefinition,
  ProductDetail,
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
 */

export interface ListProductsResponse {
  data: ProductSummary[];
  pagination: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
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
  const qs = params.toString();
  return apiGetForViewer<ListProductsResponse>(
    `/api/v1/catalog/products${qs ? `?${qs}` : ''}`,
    ctx,
    { revalidate: 60, tags: ['catalog:products'] },
  );
}

export async function getProductBySlug(
  slug: string,
  ctx: RequestContext,
): Promise<ProductDetail> {
  const res = await apiGetForViewer<{ data: ProductDetail }>(
    `/api/v1/catalog/products/${encodeURIComponent(slug)}`,
    ctx,
    { revalidate: 60, tags: ['catalog:product', `catalog:product:${slug}`] },
  );
  return res.data;
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
      `/api/v1/catalog/products/${encodeURIComponent(productIdOrSlug)}/links?kind=${kind}`,
      ctx,
      { revalidate: 60, tags: ['catalog:links', `catalog:product:${productIdOrSlug}`] },
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

export async function getFilters(ctx: RequestContext): Promise<FilterDefinition[]> {
  const res = await apiGet<{ data: FilterDefinition[] }>(
    '/api/v1/catalog/filters',
    ctx,
    { revalidate: 300, tags: ['catalog:filters'] },
  );
  return res.data;
}
