import type { ProductSummary } from '@endora-commerce/contracts';
import {
  SearchBackendUnavailable,
  type SearchQueryService,
  type SearchQueryContext,
} from './search-query.service.js';

/**
 * SearchSuggestService — feature 006 / US1 / T012.
 *
 * Narrow typeahead-popup adapter on top of {@link SearchQueryService}.
 * The full results page reuses `/api/v1/catalog/products?q=…`; this service
 * exists so the popup can:
 *
 *   1. Cap the response to a small slice (no FilterPanel, no facet
 *      metadata, no pagination) — payload bounded by `limit`.
 *   2. Enforce the same minimum-query-length contract the storefront
 *      enforces client-side, server-side too (the popup can never bypass
 *      it via curl).
 *   3. Echo the resolved threshold back to the client so the storefront
 *      component can self-correct without a separate settings round-trip.
 *
 * Per-channel defaults for `limit` and `minimumQueryLength` will move to
 * the Settings module in US2 (T024 wires the settings-aware provider);
 * for US1 they fall back to the foundation-time defaults declared in the
 * data model.
 */

export const DEFAULT_SUGGESTION_COUNT = 8;
export const DEFAULT_MINIMUM_QUERY_LENGTH = 3;

export interface SuggestionCountConfig {
  defaultLimit: number;
  minimumQueryLength: number;
}

export interface SearchSuggestParams {
  q: string;
  limit?: number | undefined;
}

export interface SearchSuggestResult {
  data: ProductSummary[];
  meta: {
    limit: number;
    minimumQueryLength: number;
    queryEcho: string;
  };
}

/** Sentinel thrown when the trimmed query is shorter than the resolved minimum. */
export class QueryTooShort extends Error {
  constructor(public readonly minimumQueryLength: number) {
    super(`query is shorter than the minimum length of ${minimumQueryLength}`);
    this.name = 'QueryTooShort';
  }
}

export class SearchSuggestService {
  constructor(
    private readonly searchQueryService: SearchQueryService,
    private readonly resolveConfig: (
      ctx: SearchQueryContext,
    ) => Promise<SuggestionCountConfig> | SuggestionCountConfig = () => ({
      defaultLimit: DEFAULT_SUGGESTION_COUNT,
      minimumQueryLength: DEFAULT_MINIMUM_QUERY_LENGTH,
    }),
  ) {}

  async suggest(
    params: SearchSuggestParams,
    ctx: SearchQueryContext,
  ): Promise<SearchSuggestResult> {
    const cfg = await this.resolveConfig(ctx);
    const trimmed = params.q.trim();
    if (trimmed.length < cfg.minimumQueryLength) {
      throw new QueryTooShort(cfg.minimumQueryLength);
    }
    const limit = params.limit ?? cfg.defaultLimit;
    // SearchQueryService throws SearchBackendUnavailable on Meilisearch
    // outage; the route wrapper translates it into a 503.
    const result = await this.searchQueryService.listProducts(
      { q: trimmed, limit, sort: 'relevance' },
      ctx,
    );
    return {
      data: result.data,
      meta: {
        limit,
        minimumQueryLength: cfg.minimumQueryLength,
        queryEcho: trimmed,
      },
    };
  }
}

export { SearchBackendUnavailable };
