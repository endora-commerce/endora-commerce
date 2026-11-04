import { describe, expect, it } from 'vitest';
import { AVAILABILITY_FILTERABLE_ATTRIBUTES, pendingAvailabilitySettings } from './search-availability.js';

/**
 * Feature 163 (code review W1) — an index built before the upgrade does not know
 * the availability fields as filterable, so every query naming them would be
 * refused and fall back to Postgres until somebody reindexed. At boot each
 * existing channel index is compared with what this release needs, and only the
 * settings that are missing are pushed — a settings update re-indexes the
 * corpus it lands on, so an index already up to date is left alone.
 */
const WANTED = {
  filterable: ['categoryIds', 'categorySlugs', 'status', ...AVAILABILITY_FILTERABLE_ATTRIBUTES, 'attributes.color'],
  searchable: ['sku', 'texts', 'attributes'],
};

describe('pendingAvailabilitySettings', () => {
  it('asks for nothing when the index already filters on every availability field and searches the texts', () => {
    expect(pendingAvailabilitySettings({ filterable: WANTED.filterable, searchable: WANTED.searchable }, WANTED)).toEqual({});
  });

  it('pushes the filterable set when an availability field is missing (a pre-upgrade index)', () => {
    const current = { filterable: ['categoryIds', 'categorySlugs', 'status', 'visibility'], searchable: WANTED.searchable };
    expect(pendingAvailabilitySettings(current, WANTED)).toEqual({ filterable: WANTED.filterable });
  });

  // Feature 172 (`contracts/search-index.md` §2) — an index built before 172 carries no `texts`
  // in its documents, so a settings push is not enough: the boot check reindexes it.
  it('asks for a reindex when the index does not search the language-keyed texts (a pre-172 index)', () => {
    const current = { filterable: WANTED.filterable, searchable: ['name', 'localized' + 'Names', 'sku', 'description'] };
    expect(pendingAvailabilitySettings(current, WANTED)).toEqual({ reindex: true });
  });

  it("reads Meilisearch's default `*` as searching everything", () => {
    expect(pendingAvailabilitySettings({ filterable: WANTED.filterable, searchable: ['*'] }, WANTED)).toEqual({});
  });
});
