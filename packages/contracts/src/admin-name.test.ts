import { describe, expect, it } from 'vitest';
import { foldAdminName } from './admin-name.js';
import { foldDiacritics } from './text-normalization.js';

/**
 * Why `foldAdminName` is not an import of `foldDiacritics` (feature 161,
 * Checkpoint 8 ruling; `check:diacritic-folds` ledger).
 *
 * `foldAdminName` must equal `catalog`'s SQL `catalog_admin_fold`, which
 * builds the stored admin sort and search keys (parity:
 * `backend/test/integration/price_lists/admin-name-rule-parity.test.ts`).
 * The shared fold answers differently on exactly the inputs below, so
 * composing it would make the grid's order disagree with the stored keys.
 * Should the two ever agree on all of them, this test fails and the ledger
 * entry can go.
 */
describe('foldAdminName against foldDiacritics', () => {
  it.each([
    ['Straße', 'strase', 'strasse'],
    ['Ærø', 'aro', 'aero'],
    ['þorn', 'þorn', 'thorn'],
    ['cœur', 'cœur', 'coeur'],
    ['ǅemal', 'dzemal', 'ǆemal'],
    ['a^b', 'a^b', 'ab'],
  ])('%s: the admin fold %s, the shared fold %s', (text, admin, shared) => {
    expect(foldAdminName(text)).toBe(admin);
    expect(foldDiacritics(text)).toBe(shared);
  });

  it('agrees with the shared fold on ł, Ł and the Polish letters', () => {
    for (const text of ['Łącznik', 'ŻÓŁW', 'Ąę Ćń Óś Źż']) expect(foldAdminName(text)).toBe(foldDiacritics(text));
  });
});
