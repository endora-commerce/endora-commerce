import { apiClient } from '@endora-commerce/admin-kit/lib';
import type {
  FeedTaxonomyCheck,
  FeedTaxonomyRevision,
  TaxonomyProviderCode,
} from '@endora-commerce/contracts';

/**
 * Admin API client for provider taxonomies and category mappings
 * (feature 067, contracts/admin-taxonomy-mappings.md §1).
 *
 * A sibling namespace to `/product-feeds` because mappings are
 * installation-wide, not per feed (FR-081).
 *
 * There is no call that uploads a taxonomy file, and none that makes a revision
 * current in one step — and there is not meant to be. A revision arrives either
 * bundled with the platform or from the optional, off-by-default check, and in
 * both cases it lands **inactive**: `promoteRevision` is the one call that
 * changes what a feed emits, and it carries the impact figure the operator was
 * shown (FR-086, FR-095).
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

  // -------------------------------------------------------------------------
  // Revision refresh (FR-078, FR-094 – FR-096)
  // -------------------------------------------------------------------------

  listRevisions(
    providerCode: TaxonomyProviderCode,
  ): Promise<{ data: FeedTaxonomyRevision[] }> {
    return apiClient.get<{ data: FeedTaxonomyRevision[] }>(
      `${BASE}/revisions?providerCode=${providerCode}`,
    );
  },

  /** Read-only: the server performs no writes for this call (FR-094). */
  revisionImpact(
    taxonomyId: string,
    lang?: string,
  ): Promise<{ data: TaxonomyRevisionImpactDto }> {
    const qs = lang ? `?lang=${encodeURIComponent(lang)}` : '';
    return apiClient.get<{ data: TaxonomyRevisionImpactDto }>(
      `${BASE}/revisions/${taxonomyId}/impact${qs}`,
    );
  },

  /**
   * The one call that changes what a feed emits. It carries the figure the
   * impact drawer showed, and the server refuses it if that figure no longer
   * matches — so "the operator saw the impact" is a server-side fact rather
   * than a UI convention (FR-095).
   */
  promoteRevision(input: {
    taxonomyId: string;
    expectedStaleMappingCount: number;
  }): Promise<{ data: FeedTaxonomyRevision }> {
    return apiClient.post<{ data: FeedTaxonomyRevision }>(
      `${BASE}/revisions/${input.taxonomyId}/promote`,
      { expectedStaleMappingCount: input.expectedStaleMappingCount },
    );
  },

  listChecks(providerCode: TaxonomyProviderCode): Promise<{ data: FeedTaxonomyCheck[] }> {
    return apiClient.get<{ data: FeedTaxonomyCheck[] }>(
      `${BASE}/checks?providerCode=${providerCode}`,
    );
  },

  startCheck(providerCode: TaxonomyProviderCode): Promise<{ data: FeedTaxonomyCheck }> {
    return apiClient.post<{ data: FeedTaxonomyCheck }>(`${BASE}/checks`, { providerCode });
  },
};

export interface TaxonomyImpactCategoryDto {
  categoryId: string;
  categoryName: string;
  nodeExternalId: string;
  nodeFullPath: string | null;
  effect: 'becomes_stale' | 'becomes_live' | 'loses_coverage';
  descendantsLosingCoverage: number;
}

export interface TaxonomyRevisionImpactDto {
  providerCode: TaxonomyProviderCode;
  candidateRevision: string;
  currentRevision: string | null;
  nodeCountCurrent: number;
  nodeCountCandidate: number;
  nodesAdded: number;
  nodesRemoved: number;
  mappings: {
    total: number;
    wouldRemainLive: number;
    wouldBecomeStale: number;
    wouldBecomeLive: number;
  };
  categories: {
    total: number;
    coveredNow: number;
    coveredAfter: number;
    losingCoverage: number;
  };
  affected: TaxonomyImpactCategoryDto[];
  affectedTruncated: boolean;
}

export type { FeedTaxonomyCheck, FeedTaxonomyRevision };
