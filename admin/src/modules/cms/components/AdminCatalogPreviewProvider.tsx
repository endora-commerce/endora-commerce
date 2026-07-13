'use client';

import { useMemo, type ReactNode } from 'react';
import type { CatalogPreviewApi, CmsCategoryNode, CmsProductSummary } from '@b2b/cms-components';
import { CatalogPreviewProvider as CmsCatalogPreviewProvider } from '@b2b/cms-components';
import { apiClient } from '@/lib/api-client';

interface AdminProduct {
  id: string;
  slug: string;
  name: Record<string, string> | string;
  sku: string;
}

interface AdminCategory {
  id: string;
  parentCategoryId: string | null;
  name: Record<string, string>;
  slug: string;
  sortOrder: number;
}

function pickName(name: Record<string, string> | string, fallback: string): string {
  if (typeof name === 'string') return name || fallback;
  return name['pl-PL'] ?? name['en-US'] ?? Object.values(name)[0] ?? fallback;
}

function mapAdminProduct(product: AdminProduct): CmsProductSummary {
  return {
    id: product.id,
    slug: product.slug,
    name: pickName(product.name, product.slug),
    sku: product.sku,
    primaryAssetUrl: null,
    price: null,
    stockLevel: null,
  };
}

function buildCategoryTree(categories: AdminCategory[]): CmsCategoryNode[] {
  const byParent = new Map<string | null, AdminCategory[]>();
  for (const cat of categories) {
    const key = cat.parentCategoryId;
    const list = byParent.get(key) ?? [];
    list.push(cat);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.slug.localeCompare(b.slug));
  }

  const toNode = (cat: AdminCategory): CmsCategoryNode => ({
    id: cat.id,
    name: pickName(cat.name, cat.slug),
    slug: cat.slug,
    sortOrder: cat.sortOrder,
    productCount: 0,
    children: (byParent.get(cat.id) ?? []).map(toNode),
  });

  return (byParent.get(null) ?? []).map(toNode);
}

async function fetchAdminProducts(params: {
  q?: string;
  page?: number;
  pageSize?: number;
}): Promise<AdminProduct[]> {
  const search = new URLSearchParams();
  search.set('page', String(params.page ?? 0));
  search.set('pageSize', String(params.pageSize ?? 20));
  if (params.q?.trim()) search.set('q', params.q.trim());
  const res = await apiClient.get<{ data: AdminProduct[] }>(
    `/api/v1/admin/catalog/products?${search.toString()}`,
  );
  return res.data;
}

function createAdminCatalogPreviewApi(): CatalogPreviewApi {
  return {
    async fetchProductsBySlugs(slugs: string[]): Promise<CmsProductSummary[]> {
      if (slugs.length === 0) return [];
      const unique = [...new Set(slugs)];
      const found = await Promise.all(
        unique.map(async (slug) => {
          const rows = await fetchAdminProducts({ q: slug, pageSize: 10 });
          return rows.find((p) => p.slug === slug) ?? null;
        }),
      );
      const bySlug = new Map(
        found.filter(Boolean).map((p) => [p!.slug, mapAdminProduct(p!)]),
      );
      return slugs.map((slug) => bySlug.get(slug)).filter(Boolean) as CmsProductSummary[];
    },

    async fetchProductsList(query: {
      categorySlug?: string;
      q?: string;
      limit?: number;
    }): Promise<CmsProductSummary[]> {
      const limit = query.limit ?? 12;
      if (query.categorySlug) {
        const params = new URLSearchParams();
        params.set('filter[category]', query.categorySlug);
        params.set('limit', String(limit));
        try {
          const res = await apiClient.get<{ data: CmsProductSummary[] }>(
            `/api/v1/catalog/products?${params.toString()}`,
            { headers: { 'x-sales-channel': 'default' } },
          );
          return res.data;
        } catch {
          return [];
        }
      }
      const rows = await fetchAdminProducts({
        ...(query.q ? { q: query.q } : {}),
        pageSize: limit,
      });
      return rows.map(mapAdminProduct);
    },

    async fetchCategoryTree(): Promise<CmsCategoryNode[]> {
      const res = await apiClient.get<{ data: AdminCategory[] }>('/api/v1/admin/catalog/categories');
      return buildCategoryTree(res.data);
    },
  };
}

export function AdminCatalogPreviewProvider({ children }: { children: ReactNode }): React.ReactElement {
  const api = useMemo(() => createAdminCatalogPreviewApi(), []);
  return <CmsCatalogPreviewProvider api={api}>{children}</CmsCatalogPreviewProvider>;
}
