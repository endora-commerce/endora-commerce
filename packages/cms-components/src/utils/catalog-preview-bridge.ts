import type { CmsCategoryNode, CmsProductSummary } from '../schema/catalog-types.js';

export interface CatalogPreviewApi {
  fetchProductsBySlugs: (slugs: string[]) => Promise<CmsProductSummary[]>;
  fetchProductsList: (query: {
    categorySlug?: string;
    q?: string;
    limit?: number;
  }) => Promise<CmsProductSummary[]>;
  fetchCategoryTree: () => Promise<CmsCategoryNode[]>;
}

let previewApiGetter: (() => CatalogPreviewApi | null) | null = null;

export function registerCatalogPreviewGetter(getter: (() => CatalogPreviewApi | null) | null): void {
  previewApiGetter = getter;
}

export function getCatalogPreviewApi(): CatalogPreviewApi | null {
  return previewApiGetter?.() ?? null;
}
