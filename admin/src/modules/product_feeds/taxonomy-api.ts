import { apiClient } from '@/lib/api-client';
import type { TaxonomyProviderCode } from '@b2b/contracts';

/**
 * Admin API client for provider taxonomies and category mappings
 * (feature 067, contracts/admin-taxonomy-mappings.md §1).
 *
 * A sibling namespace to `/product-feeds` because mappings are
 * installation-wide, not per feed (FR-081). There is no install/upload/refresh
 * call, and there is not meant to be: taxonomies arrive with a platform
 * upgrade, never over the network at runtime (FR-077).
 */

const BASE = '/api/v1/admin/feed-taxonomies';

export interface InstalledTaxonomy {
  providerCode: TaxonomyProviderCode;
  revision: string;
  nodeCount: number;
  installedAt: string;
}

export interface TaxonomyNodeOption {
  externalId: string;
  parentExternalId: string | null;
  label: string;
  fullPath: string;
  depth: number;
}

export type MappingOrigin = 'explicit' | 'inherited' | 'none';

export interface CategoryMappingRowDto {
  categoryId: string;
  categoryName: string;
  categoryDepth: number;
  nodeExternalId: string | null;
  nodeFullPath: string | null;
  origin: MappingOrigin;
  inheritedFromCategoryId: string | null;
  inheritedFromCategoryName: string | null;
  stale: boolean;
}

export interface TaxonomyCoverage {
  providerCode: TaxonomyProviderCode;
  revision: string;
  totalCategories: number;
  explicitlyMapped: number;
  coveredByInheritance: number;
  uncovered: number;
  staleMappings: number;
}

export const feedTaxonomiesClient = {
  listInstalled(): Promise<{ data: InstalledTaxonomy[] }> {
    return apiClient.get<{ data: InstalledTaxonomy[] }>(BASE);
  },

  searchNodes(input: {
    providerCode: TaxonomyProviderCode;
    q?: string;
    lang?: string;
    limit?: number;
  }): Promise<{ data: TaxonomyNodeOption[] }> {
    const qs = new URLSearchParams({ providerCode: input.providerCode });
    if (input.q) qs.set('q', input.q);
    if (input.lang) qs.set('lang', input.lang);
    if (input.limit) qs.set('limit', String(input.limit));
    return apiClient.get<{ data: TaxonomyNodeOption[] }>(`${BASE}/nodes?${qs.toString()}`);
  },

  listMappings(input: {
    providerCode: TaxonomyProviderCode;
    lang?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: CategoryMappingRowDto[]; pagination: { hasMore: boolean } }> {
    const qs = new URLSearchParams({ providerCode: input.providerCode });
    if (input.lang) qs.set('lang', input.lang);
    qs.set('limit', String(input.limit ?? 200));
    if (input.offset) qs.set('offset', String(input.offset));
    return apiClient.get(`${BASE}/mappings?${qs.toString()}`);
  },

  setMapping(input: {
    providerCode: TaxonomyProviderCode;
    categoryId: string;
    nodeExternalId: string | null;
  }): Promise<{ data: CategoryMappingRowDto }> {
    return apiClient.put<{ data: CategoryMappingRowDto }>(`${BASE}/mappings`, input);
  },

  coverage(providerCode: TaxonomyProviderCode): Promise<{ data: TaxonomyCoverage }> {
    return apiClient.get<{ data: TaxonomyCoverage }>(
      `${BASE}/coverage?providerCode=${providerCode}`,
    );
  },
};
