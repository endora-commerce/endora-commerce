import { describe, expect, it } from 'vitest';
import { slugify } from '../../../../packages/modules/product_feeds/src/admin/api';

/**
 * Issue #239 — the feed slug generator dropped `ł` outright.
 *
 * `Kanał sprzedaży` (the shipped `feeds.table.channel` label, and exactly what
 * an operator names a feed after) produced `kana-sprzedazy`: the letter was
 * not folded to `l`, it was deleted, and then the gap collapsed into the
 * separator. The operator sees a slug that is missing a letter and has no way
 * to tell why.
 *
 * The owner's ruling of 2026-08-19: repair the fold so new slugs are correct,
 * and leave historical values alone. Two developer environments exist; nobody
 * benefits from renaming their feeds.
 *
 * This is the admin SPA's `product_feeds` module (`admin/src/modules/…`), not
 * the backend module of the same name — the backend's own slugifiers stay
 * ledgered in `check:diacritic-folds`.
 */
describe('product feed slugify — stroked letters (issue #239)', () => {
  it('folds ł to l instead of deleting it', () => {
    expect(slugify('Kanał sprzedaży')).toBe('kanal-sprzedazy');
  });

  it('folds ordinary combining diacritics', () => {
    expect(slugify('Ścieżka kategorii')).toBe('sciezka-kategorii');
  });

  it('keeps an ASCII name unchanged', () => {
    expect(slugify('Google Merchant Center')).toBe('google-merchant-center');
  });

  it('still trims the separators it introduces at the edges', () => {
    expect(slugify('  Kanał  ')).toBe('kanal');
  });

  it('still caps the slug at 160 characters', () => {
    expect(slugify('ł'.repeat(400))).toHaveLength(160);
  });
});
