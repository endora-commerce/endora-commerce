import { describe, expect, it } from 'vitest';
import type { SearchListProductsParams } from '@endora-commerce/contracts';
import { SORTABLE_ATTRIBUTES } from './search-indexer.js';
import { buildSort } from './search-query.service.js';

/**
 * Issue #287 — every sort the listing contract offers must name a field the
 * index was told it may sort on.
 *
 * `sortableAttributes` was `[]` on all five live indexes because
 * `SearchIndexer` never called `updateSortableAttributes`, so Meilisearch
 * answered `name:asc` with `invalid_search_sort` and three of the four sorts
 * were silently re-run against Postgres through the unreachable-index
 * fallback. The two halves of that defect are one declaration apart, so the
 * declaration is now single: `SORTABLE_ATTRIBUTES` is what the indexer
 * applies AND the alphabet `buildSort` may emit.
 *
 * This is the runtime half of the guarantee; the compile-time half is
 * `buildSort`'s return type, which cannot spell a field outside the constant.
 */

const EVERY_SORT_TOKEN: Array<SearchListProductsParams['sort']> = [
  undefined,
  'relevance',
  '-createdAt',
  'name',
  '-name',
  // Feature 086. Neither reaches this backend — the route sends a price
  // ordering to Postgres before it chooses Meilisearch — but the array claims
  // to be *every* token the listing contract offers, and a token missing from
  // it is a token nothing checks. Both answer `[]`, which is what a field the
  // document does not carry must answer.
  'price',
  '-price',
];

describe('buildSort ⇄ SORTABLE_ATTRIBUTES', () => {
  it('emits only fields the index was told it may sort on', () => {
    for (const token of EVERY_SORT_TOKEN) {
      for (const expression of buildSort(token)) {
        const field = expression.split(':')[0];
        expect(
          SORTABLE_ATTRIBUTES as readonly string[],
          `sort=${String(token)} asks Meilisearch to sort on "${field}", which the indexer never declares sortable`,
        ).toContain(field);
      }
    }
  });

  it('sorts "newest first" by the field the token names', () => {
    // `-createdAt` used to translate to `updatedAt:desc` — a different
    // question ("most recently edited") answered under the name of this one,
    // and one the Postgres backend of the same route answers with
    // `createdAt desc`. Two backends behind one route may not disagree about
    // what a sort token means.
    expect(buildSort('-createdAt')).toEqual(['createdAt:desc']);
  });

  it('leaves relevance to the engine ranking rules', () => {
    expect(buildSort(undefined)).toEqual([]);
    expect(buildSort('relevance')).toEqual([]);
  });

  it('sorts by name in both directions', () => {
    expect(buildSort('name')).toEqual(['name:asc']);
    expect(buildSort('-name')).toEqual(['name:desc']);
  });
});
