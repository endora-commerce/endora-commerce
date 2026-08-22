'use client';

import { useMemo, type ReactNode } from 'react';
import type { CatalogPreviewApi, CmsCategoryNode, CmsProductSummary } from '@endora-commerce/cms-components';
import { CatalogPreviewProvider as CmsCatalogPreviewProvider } from '@endora-commerce/cms-components';
import { apiClient } from '@/lib/api-client';
import {
  mapAdminProductToCmsSummary,
  pickAdminLocalizedName,
} from './admin-catalog-preview-map';

export { mapAdminProductToCmsSummary, pickAdminLocalizedName } from './admin-catalog-preview-map';

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
    name: pickAdminLocalizedName(cat.name, cat.slug),
    slug: cat.slug,
    sortOrder: cat.sortOrder,
    productCount: 0,
    children: (byParent.get(cat.id) ?? []).map(toNode),
  });

  return (byParent.get(null) ?? []).map(toNode);
}

async function fetchAdminProducts(params: {
  q?: string;
  categorySlug?: string;
  page?: number;
  pageSize?: number;
}): Promise<AdminProduct[]> {
  const search = new URLSearchParams();
  search.set('page', String(params.page ?? 0));
  search.set('pageSize', String(params.pageSize ?? 20));
  if (params.q?.trim()) search.set('q', params.q.trim());
  if (params.categorySlug?.trim()) search.set('categorySlug', params.categorySlug.trim());
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
        found.filter(Boolean).map((p) => [p!.slug, mapAdminProductToCmsSummary(p!)]),
      );
      return slugs.map((slug) => bySlug.get(slug)).filter(Boolean) as CmsProductSummary[];
    },

    async fetchProductsList(query: {
      categorySlug?: string;
      q?: string;
      limit?: number;
    }): Promise<CmsProductSummary[]> {
      const limit = query.limit ?? 12;
      // Admin list is not sales-channel-scoped (unlike the public catalog). Use it for
      // category and search previews so editors see products without channel membership.
      const rows = await fetchAdminProducts({
        ...(query.categorySlug ? { categorySlug: query.categorySlug } : {}),
        ...(query.q ? { q: query.q } : {}),
        pageSize: limit,
      });
      return rows.map(mapAdminProductToCmsSummary);
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
