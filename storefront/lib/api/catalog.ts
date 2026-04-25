import type {
  CategoryNode,
  FilterDefinition,
  ProductDetail,
  ProductSummary,
} from '@b2b/contracts';
import { apiGet, type RequestContext } from './client';

/**
 * Catalog read paths. The API returns a Zod-derived shape; we re-export
 * those types from `@b2b/contracts` so themes that only override
 * `components/*` keep the same prop contracts.
 */

export interface ListProductsResponse {
  data: ProductSummary[];
  pagination: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
}

export interface ListProductsQuery {
  q?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
  sort?: 'relevance' | '-createdAt' | 'name' | '-name' | undefined;
  categorySlug?: string | undefined;
  attributeFilters?: Record<string, string[]> | undefined;
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
  if (query.categorySlug) params.set('filter[category]', query.categorySlug);
  if (query.attributeFilters) {
    for (const [key, values] of Object.entries(query.attributeFilters)) {
      for (const value of values) {
        params.append(`filter[attr.${key}]`, value);
      }
    }
  }
  const qs = params.toString();
  return apiGet<ListProductsResponse>(
    `/api/v1/catalog/products${qs ? `?${qs}` : ''}`,
    ctx,
    { revalidate: 60, tags: ['catalog:products'] },
  );
}

export async function getProductBySlug(
  slug: string,
  ctx: RequestContext,
): Promise<ProductDetail> {
  const res = await apiGet<{ data: ProductDetail }>(
    `/api/v1/catalog/products/${encodeURIComponent(slug)}`,
    ctx,
    { revalidate: 60, tags: ['catalog:product', `catalog:product:${slug}`] },
  );
  return res.data;
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
