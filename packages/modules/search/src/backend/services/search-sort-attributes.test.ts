import { describe, expect, it } from 'vitest';
import type { SearchListProductsParams } from '@endora-commerce/contracts';
import { sortableAttributesFor } from './search-document.js';
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
 *
 * Feature 174 (`contracts/search-index.md`) — the name a document sorts by is the one in the
 * shopper's language, `texts.<L>.name`; the indexer declares it for every channel language.
 */
const L = 'pl-PL';

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

describe('buildSort ⇄ sortableAttributesFor', () => {
  it('emits only fields the index was told it may sort on', () => {
    for (const token of EVERY_SORT_TOKEN) {
      for (const expression of buildSort(token, L)) {
        const field = expression.split(':')[0];
        expect(
          sortableAttributesFor([L]),
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
    expect(buildSort('-createdAt', L)).toEqual(['createdAt:desc']);
  });

  it('leaves relevance to the engine ranking rules', () => {
    expect(buildSort(undefined, L)).toEqual([]);
    expect(buildSort('relevance', L)).toEqual([]);
  });

  it("sorts by the name in the shopper's language, in both directions", () => {
    expect(buildSort('name', L)).toEqual(['texts.pl-PL.name:asc']);
    expect(buildSort('-name', 'en-US')).toEqual(['texts.en-US.name:desc']);
  });
});
