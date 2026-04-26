import { describe, expect, it } from 'vitest';
import {
  buildFilterExpression,
  buildSort,
  SearchBackendUnavailable,
  SearchQueryService,
} from '../../../src/modules/search/services/search-query.service.js';

/**
 * T068 — pure-unit tests on the filter/sort translator and the
 * reserved-fallback contract. Doesn't touch the DB or Meilisearch.
 */

describe('buildFilterExpression', () => {
  it('returns the empty list when nothing was supplied', () => {
    expect(buildFilterExpression({})).toEqual([]);
  });

  it('emits a category equality clause', () => {
    expect(
      buildFilterExpression({ categorySlug: 'screws' }),
    ).toEqual(['categorySlugs = "screws"']);
  });

  it('OR-joins multiple values for the same attribute', () => {
    expect(
      buildFilterExpression({ attributeFilters: { color: ['red', 'blue'] } }),
    ).toEqual(['(attributes.color = "red" OR attributes.color = "blue")']);
  });

  it('AND-joins separate attribute keys', () => {
    expect(
      buildFilterExpression({
        attributeFilters: { color: ['red'], material: ['steel'] },
      }),
    ).toEqual([
      '(attributes.color = "red")',
      '(attributes.material = "steel")',
    ]);
  });

  it('escapes embedded double quotes in values', () => {
    expect(
      buildFilterExpression({ attributeFilters: { name: ['a "quoted" thing'] } }),
    ).toEqual(['(attributes.name = "a \\"quoted\\" thing")']);
  });
});

describe('buildSort', () => {
  it('returns [] for relevance/undefined (Meilisearch picks ranking rules)', () => {
    expect(buildSort(undefined)).toEqual([]);
    expect(buildSort('relevance')).toEqual([]);
  });

  it('translates the catalog sort tokens', () => {
    expect(buildSort('-createdAt')).toEqual(['updatedAt:desc']);
    expect(buildSort('name')).toEqual(['name:asc']);
    expect(buildSort('-name')).toEqual(['name:desc']);
  });
});

describe('SearchQueryService — reserved-fallback contract', () => {
  it('throws SearchBackendUnavailable when Meilisearch is unreachable', async () => {
    // Stub em returns no channel and no attribute rows; the service then
    // proceeds to the Meilisearch call which fails fast against a port
    // nothing is listening on.
    const fakeEm = {
      find: async (): Promise<unknown[]> => [],
      findOne: async (): Promise<null> => null,
    };
    const service = new SearchQueryService(
      () => fakeEm as never,
      { meilisearchHost: 'http://127.0.0.1:1', meilisearchApiKey: '' },
    );
    await expect(
      service.listProducts({ limit: 10 }, {}),
    ).rejects.toThrow(SearchBackendUnavailable);
  });
});
