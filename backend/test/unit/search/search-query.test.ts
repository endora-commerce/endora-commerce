import { describe, expect, it } from 'vitest';
import { ANONYMOUS_PRODUCT_AUDIENCE, type CatalogProductReadPort } from '@b2b/contracts';
import {
  buildFilterExpression,
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

/**
 * `buildSort` is covered by `search-sort-attributes.test.ts` (issue #287),
 * where the translation is asserted against the `SORTABLE_ATTRIBUTES`
 * declaration it has to agree with. The block that lived here asserted the
 * translation alone — including `-createdAt` → `updatedAt:desc`, a field no
 * index had ever been told it could sort on — which is how three sorts that
 * failed on the live engine kept a green unit test.
 */

describe('SearchQueryService — reserved-fallback contract', () => {
  it('throws SearchBackendUnavailable when Meilisearch is unreachable', async () => {
    // The hydration never runs: the service uses the resolved channel from the
    // context (no channel query) and proceeds to the Meilisearch call, which
    // fails fast against a port nothing is listening on. Issue #153 replaced
    // the stub `EntityManager` this used to take with `catalog`'s product read
    // port; it stays unexercised for the same reason.
    const productsPort = {
      findByIds: async (): Promise<never[]> => [],
    } as unknown as CatalogProductReadPort;
    const service = new SearchQueryService(productsPort, undefined, {
      meilisearchHost: 'http://127.0.0.1:1',
      meilisearchApiKey: '',
    });
    await expect(
      service.listProducts(
        { limit: 10 },
        {
          audience: ANONYMOUS_PRODUCT_AUDIENCE,
          resolvedChannel: {
            id: '00000000-0000-4000-8000-000000000000',
            code: 'test',
            isPublic: true,
            defaultCurrency: 'PLN',
            defaultLanguage: 'en-US',
          },
        },
      ),
    ).rejects.toThrow(SearchBackendUnavailable);
  });
});
