import type { CmsCategoryNode, CmsProductSummary } from '../schema/catalog-types.js';
import { getCatalogPreviewApi } from './catalog-preview-bridge.js';

function apiBase(): string {
  if (typeof window !== 'undefined') {
    return (
      (window as unknown as { __B2B_API_BASE__?: string }).__B2B_API_BASE__ ??
      process.env['NEXT_PUBLIC_API_BASE_URL'] ??
      ''
    );
  }
  return process.env['NEXT_PUBLIC_API_BASE_URL'] ?? '';
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const base = apiBase();
  const url = base ? `${base.replace(/\/$/, '')}${path}` : path;
  const res = await fetch(url, { credentials: 'include', ...init });
  if (!res.ok) throw new Error(`Catalog fetch failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export interface ListProductsResponse {
  data: CmsProductSummary[];
}

export async function fetchProductsBySlugs(slugs: string[]): Promise<CmsProductSummary[]> {
  if (slugs.length === 0) return [];
  const preview = getCatalogPreviewApi();
  if (preview) return preview.fetchProductsBySlugs(slugs);

  const results = await Promise.all(
    slugs.map(async (slug) => {
      try {
        const res = await fetchJson<{ data: CmsProductSummary }>(
          `/api/v1/catalog/products/${encodeURIComponent(slug)}`,
        );
        return res.data;
      } catch {
        return null;
      }
    }),
  );
  const bySlug = new Map(results.filter(Boolean).map((p) => [p!.slug, p!]));
  return slugs.map((s) => bySlug.get(s)).filter(Boolean) as CmsProductSummary[];
}

export async function fetchProductsList(query: {
  categorySlug?: string;
  q?: string;
  limit?: number;
}): Promise<CmsProductSummary[]> {
  const preview = getCatalogPreviewApi();
  if (preview) return preview.fetchProductsList(query);

  const params = new URLSearchParams();
  if (query.categorySlug) params.set('filter[category]', query.categorySlug);
  if (query.q) params.set('q', query.q);
  params.set('limit', String(query.limit ?? 12));
  const qs = params.toString();
  const res = await fetchJson<ListProductsResponse>(`/api/v1/catalog/products?${qs}`);
  return res.data;
}

export async function fetchCategoryTree(): Promise<CmsCategoryNode[]> {
  const preview = getCatalogPreviewApi();
  if (preview) return preview.fetchCategoryTree();

  const res = await fetchJson<{ data: CmsCategoryNode[] }>('/api/v1/catalog/categories');
  return res.data;
}

export function flattenCategories(
  nodes: CmsCategoryNode[],
  depth = 0,
): { slug: string; name: string; productCount: number; depth: number }[] {
  const out: { slug: string; name: string; productCount: number; depth: number }[] = [];
  for (const node of nodes) {
    out.push({ slug: node.slug, name: node.name, productCount: node.productCount, depth });
    out.push(...flattenCategories(node.children, depth + 1));
  }
  return out;
}

function findCategory(nodes: CmsCategoryNode[], slug: string): CmsCategoryNode | null {
  for (const node of nodes) {
    if (node.slug === slug) return node;
    const found = findCategory(node.children, slug);
    if (found) return found;
  }
  return null;
}

export function filterCategories(
  nodes: CmsCategoryNode[],
  opts: {
    selectionMode: 'all' | 'manual' | 'childrenOf';
    categorySlugs?: string[];
    parentSlug?: string;
    maxDepth?: number;
  },
): { slug: string; name: string; productCount: number; depth: number }[] {
  const flat = flattenCategories(nodes);
  if (opts.selectionMode === 'manual') {
    const slugSet = new Set(opts.categorySlugs ?? []);
    return flat.filter((c) => slugSet.has(c.slug));
  }
  if (opts.selectionMode === 'childrenOf' && opts.parentSlug) {
    const parent = findCategory(nodes, opts.parentSlug);
    return flattenCategories(parent?.children ?? [], 0);
  }
  const maxDepth = opts.maxDepth;
  return maxDepth !== undefined ? flat.filter((c) => c.depth <= maxDepth) : flat;
}
