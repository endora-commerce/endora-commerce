'use client';

import { useMemo, type ReactNode } from 'react';
import type {
  CatalogPreviewApi,
  CmsBlogPostCard,
  CmsCategoryNode,
  CmsProductSummary,
} from '@endora-commerce/cms-components';
import { CatalogPreviewProvider as CmsCatalogPreviewProvider } from '@endora-commerce/cms-components';
import type { FormBlockData, FormEditorNote } from '@endora-commerce/cms-components/utils/catalog-preview-bridge';
import type { PublicFormDefinition } from '@endora-commerce/contracts';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  mapAdminProductToCmsSummary,
  pickAdminLocalizedName,
} from './admin-catalog-preview-map.js';

export { mapAdminProductToCmsSummary, pickAdminLocalizedName } from './admin-catalog-preview-map.js';

interface AdminProduct {
  id: string;
  slug: string;
  /** Feature 174 (FR-031) — the Global name. */
  name: string;
  sku: string;
  /** The Global description, from which the card's summary is derived (T196). */
  description?: string | null;
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

interface AdminBlogPost {
  id: string;
  slug: string;
  name: Record<string, string>;
  publishedAt: string | null;
  description: string | null;
  mainImageAssetId?: string | null;
  categoryIds: string[];
}

interface AdminBlogCategoryNode {
  id: string;
  slug: string;
  name: Record<string, string>;
  children?: AdminBlogCategoryNode[];
}

function flattenBlogCategories(nodes: AdminBlogCategoryNode[]): AdminBlogCategoryNode[] {
  return nodes.flatMap((node) => [node, ...flattenBlogCategories(node.children ?? [])]);
}

/**
 * The editor's preview of `blog.LatestPosts` (feature 163): the newest
 * published posts through the admin blog API, which is not channel-scoped —
 * as the product previews above. The admin API lists by last change, so a
 * page of posts is read and ordered by publication here. Images come from the
 * admin asset read. A missing `blog` (its admin API answers 404 or 503) fails
 * the read, and the block shows its preview note.
 */
async function fetchAdminBlogPosts(query: { limit: number; categorySlug?: string }): Promise<CmsBlogPostCard[]> {
  const categories = flattenBlogCategories(
    (await apiClient.get<{ tree: AdminBlogCategoryNode[] }>('/api/v1/admin/blog/categories')).tree,
  );
  const bySlug = new Map(categories.map((category) => [category.slug, category]));
  const byId = new Map(categories.map((category) => [category.id, category]));
  const search = new URLSearchParams({ status: 'published', perPage: '100' });
  if (query.categorySlug) {
    const category = bySlug.get(query.categorySlug);
    if (!category) return [];
    search.set('categoryId', category.id);
  }
  const rows = (await apiClient.get<{ data: AdminBlogPost[] }>(`/api/v1/admin/blog/posts?${search.toString()}`)).data;
  const newest = [...rows]
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    .slice(0, query.limit);
  return Promise.all(
    newest.map(async (post): Promise<CmsBlogPostCard> => {
      const category = post.categoryIds.map((id) => byId.get(id)).find(Boolean) ?? null;
      let mainImageUrl: string | null = null;
      if (post.mainImageAssetId) {
        try {
          mainImageUrl = (await apiClient.get<{ data: { url: string } }>(`/api/v1/admin/assets/${post.mainImageAssetId}`)).data.url;
        } catch {
          mainImageUrl = null;
        }
      }
      return {
        id: post.id,
        slug: post.slug,
        name: pickAdminLocalizedName(post.name, post.slug),
        publishedAt: post.publishedAt,
        excerpt: post.description,
        mainImageUrl,
        primaryCategorySlug: category?.slug ?? null,
        primaryCategoryName: category ? pickAdminLocalizedName(category.name, category.slug) : null,
        url: `/blog/${post.slug}`,
      };
    }),
  );
}

/** The admin preview of a form: its public read, and the form's status. */
type AdminFormPreview = PublicFormDefinition & { status: 'draft' | 'published' | 'closed' };

/**
 * Feature 170 (`specs/170-forms-module/` contracts/blocks-and-storefront.md §3, §6, US2-3) — the
 * canvas's read of a `forms.Form` block's form, through the `forms` module's admin preview over
 * HTTP (`cms` gains no dependency on `forms`): the published version, or the working copy of a
 * draft, so the editor sees the form they placed — with a note saying a shopper would not see a
 * draft, that a form is closed, that it is gone, or that the editor may not view forms.
 */
export async function fetchAdminFormRead(
  formId: string,
  notes: Readonly<Record<FormEditorNote, string>>,
): Promise<FormBlockData> {
  const path = (source: 'published' | 'working') =>
    `/api/v1/admin/forms/${encodeURIComponent(formId)}/preview?source=${source}`;
  const noted = (code: FormEditorNote) => ({ code, message: notes[code] });
  try {
    const published = (await apiClient.get<{ data: AdminFormPreview }>(path('published'))).data;
    if (published.status === 'draft') {
      const working = (await apiClient.get<{ data: AdminFormPreview }>(path('working'))).data;
      const { status: _status, ...read } = working;
      return { ...read, editorNote: noted('draft') };
    }
    const { status, ...read } = published;
    return status === 'closed' ? { ...read, editorNote: noted('closed') } : read;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
      return { formId, availability: 'unavailable', editorNote: noted(error.status === 403 ? 'forbidden' : 'not_found') };
    }
    throw error;
  }
}

function createAdminCatalogPreviewApi(formNotes: Readonly<Record<FormEditorNote, string>>): CatalogPreviewApi {
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

    fetchBlogPosts: fetchAdminBlogPosts,
    fetchForm: (formId: string) => fetchAdminFormRead(formId, formNotes),
  };
}

export function AdminCatalogPreviewProvider({ children }: { children: ReactNode }): React.ReactElement {
  const t = useTranslation('cms');
  const draft = t('blocks.form.note.draft');
  const closed = t('blocks.form.note.closed');
  const notFound = t('blocks.form.note.notFound');
  const forbidden = t('blocks.form.note.forbidden');
  const api = useMemo(
    () => createAdminCatalogPreviewApi({ draft, closed, not_found: notFound, forbidden }),
    [draft, closed, notFound, forbidden],
  );
  return <CmsCatalogPreviewProvider api={api}>{children}</CmsCatalogPreviewProvider>;
}
