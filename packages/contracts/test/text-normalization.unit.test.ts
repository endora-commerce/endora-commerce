import { describe, expect, it } from 'vitest';
import { NON_DECOMPOSING_LATIN, foldDiacritics, slugify } from '../src/text-normalization.js';

/**
 * The repository's one fold and its one slug generator (issues #240, #245).
 *
 * The generator replaced eight private four-line chains. What follows is the
 * characterisation of the shared one, plus — as its own describe block — the
 * table of what each of the eight now produces, so a change to the steps shows
 * up as eight named diffs rather than as one abstract one.
 *
 * Every fixture with a diacritic in it is a string this repository actually
 * ships: nodes of the Google Merchant taxonomy under
 * `backend/src/modules/product_feeds/data/taxonomies/google_merchant/2021-09-21/pl.txt`,
 * catalog labels from `backend/src/seeds/dev-catalog-seed.ts`, and UI strings
 * from the admin's Polish bundles. Strings invented to fold nicely prove
 * nothing about the names an operator types.
 */
describe('foldDiacritics', () => {
  it('folds the letters NFD leaves standing, which is the whole point', () => {
    // `ł` is U+0142: no canonical decomposition, so NFD leaves it exactly where
    // it was and a strip of the combining marks removes nothing.
    expect(foldDiacritics('Łączniki')).toBe('laczniki');
    expect(foldDiacritics('Żółw')).toBe('zolw');
    expect(foldDiacritics('Metody płatności')).toBe('metody platnosci');
  });

  it('maps after decomposing, so a stroked letter under an accent still folds', () => {
    // `Ǿ` (U+01FE) decomposes to `Ø` plus an acute; a map applied first never
    // sees the `Ø` the decomposition is about to expose. That ordering is the
    // reason every key of `NON_DECOMPOSING_LATIN` has to be a code point the
    // decomposition leaves standing — asserted here through its effect rather
    // than by calling `normalize('NFD')` in a test, which `check:diacritic-folds`
    // refuses in this tree and is right to.
    expect(foldDiacritics('Ǿ')).toBe('o');
  });

  it('leaves whitespace alone — what counts as one space is the caller policy', () => {
    expect(foldDiacritics('  Łódź  ')).toBe('  lodz  ');
  });

  it('reaches the map for every letter in it', () => {
    // Each entry, through the fold: a key whose mapping is unreachable would
    // hand back the letter itself instead of the ASCII the map declares.
    for (const [character, ascii] of Object.entries(NON_DECOMPOSING_LATIN)) {
      expect(foldDiacritics(character), `${character} does not reach its mapping`).toBe(
        ascii.toLowerCase(),
      );
    }
  });
});

describe('slugify', () => {
  it('folds instead of deleting, which is what the eight private copies did not', () => {
    expect(slugify('Łatwy szablon')).toBe('latwy-szablon');
    expect(slugify('Łączniki')).toBe('laczniki');
    expect(slugify('Wiertła')).toBe('wiertla');
    expect(slugify('Żółw')).toBe('zolw');
    expect(slugify('Świeże Ćwikła')).toBe('swieze-cwikla');
  });

  it('collapses every run of unusable characters to one separator', () => {
    expect(slugify('Google Merchant Center (PL)')).toBe('google-merchant-center-pl');
    expect(slugify('a---b   c')).toBe('a-b-c');
  });

  it('takes the caller separator, because one caller stores `_`', () => {
    expect(slugify('Metody płatności', { separator: '_' })).toBe('metody_platnosci');
    // The separator lands in a character class, so one that means something to
    // a regular expression must not be able to change what the class matches.
    expect(slugify('a b', { separator: '.' })).toBe('a.b');
    expect(slugify('a b', { separator: '-' })).toBe('a-b');
  });

  it('strips the trailing separator AFTER the slice, so a cut cannot leave one', () => {
    // Six of the eight cut to length after stripping, so a cut landing on a
    // separator left the value ending in one. This is the one behaviour change
    // in issue #245 that is not about diacritics.
    expect(slugify('aaa bbb', { maxLength: 4 })).toBe('aaa');
    expect(slugify('aaa bbb', { maxLength: 5 })).toBe('aaa-b');
  });

  it('strips the leading separator BEFORE the slice, so it costs no budget', () => {
    // The other edge deliberately keeps the order all eight had: a leading
    // separator is never part of the answer, so spending a character of the
    // caller's cap on it would shorten every value whose input begins with
    // punctuation, in six sites at once, for nothing.
    expect(slugify('!!! abcd', { maxLength: 4 })).toBe('abcd');
  });

  it('does not truncate when the caller declares no maximum', () => {
    expect(slugify('a'.repeat(400))).toHaveLength(400);
  });

  it('falls back only when nothing survived', () => {
    expect(slugify('  ///  ', { fallback: 'feed-template' })).toBe('feed-template');
    expect(slugify('', { fallback: 'category' })).toBe('category');
    // No fallback declared means the empty string, which is a caller's answer
    // to give — `CatalogAdminService` allocates against the live table and
    // would rather see an empty root than a word it did not choose.
    expect(slugify('///')).toBe('');
    // A value that survives is never replaced, however short.
    expect(slugify('a', { fallback: 'x' })).toBe('a');
  });

  it('gives up NFKD, so a compatibility character collapses to the separator', () => {
    // Three of the eight normalised with NFKD, which maps `ﬁ` to `fi` and `²`
    // to `2` — mappings that reach a slug only through characters nobody types
    // into a product or template name, while `ł` was being deleted out of every
    // Polish one. The consequence, stated: two names NFKD kept apart can fold
    // together. Every unique-constrained caller allocates against the live
    // table, so the second is suffixed rather than rejected.
    expect(slugify('Kabel²')).toBe('kabel');
    expect(slugify('Kabel³')).toBe('kabel');
    expect(slugify('ﬁszki')).toBe('szki');
  });

  it('passes non-Latin scripts through the collapse rather than mangling them', () => {
    // Nothing in `[a-z0-9]` survives from them, so the answer is the fallback
    // rather than a wrong transliteration. Stated because it is a limit, not a
    // bug: this is a slug generator for a Latin-script grammar.
    expect(slugify('Привет мир', { fallback: 'category' })).toBe('category');
  });
});

/**
 * The eight callers, as one table (issue #245).
 *
 * Each row is the options that site passes, and each expectation is the value
 * it produces today. The caps are **not** harmonised: 80, 150, 160, 180 and
 * none are five different columns and contracts, and a cap decides which new
 * values collide under that caller's unique constraint. This table is what
 * makes a future attempt to tidy them into one number fail loudly.
 */
describe('slugify — the eight callers', () => {
  const CALLERS = {
    'product_feeds/feed-template-io': { maxLength: 80, fallback: 'feed-template' },
    'pim_ergonode/category-phase': { maxLength: 150, fallback: 'category' },
    'catalog/catalog-admin': { maxLength: 160 },
    'admin newsletter/TagsPage': { separator: '_' },
    'admin cms/cms-template-layout': { maxLength: 180 },
    'admin cms/BlockEditor': { maxLength: 180 },
    'admin cms/PageEditor': { maxLength: 180 },
    'admin product_feeds/api': { maxLength: 160 },
  } as const;

  it('folds the same Polish name for every one of them', () => {
    // `Ładowarki do elektronarzędzi` — Google Merchant taxonomy, pl.txt:2743.
    // It used to produce five different answers: `adowarki-do-elektronarzedzi`
    // where the site normalised with NFKD, `adowarki-do-elektronarz-dzi` where
    // it did not fold at all, and the correct one only in the three that
    // composed the admin helper.
    const produced = Object.entries(CALLERS).map(
      ([site, options]) => [site, slugify('Ładowarki do elektronarzędzi', options)] as const,
    );
    expect(Object.fromEntries(produced)).toEqual({
      'product_feeds/feed-template-io': 'ladowarki-do-elektronarzedzi',
      'pim_ergonode/category-phase': 'ladowarki-do-elektronarzedzi',
      'catalog/catalog-admin': 'ladowarki-do-elektronarzedzi',
      'admin newsletter/TagsPage': 'ladowarki_do_elektronarzedzi',
      'admin cms/cms-template-layout': 'ladowarki-do-elektronarzedzi',
      'admin cms/BlockEditor': 'ladowarki-do-elektronarzedzi',
      'admin cms/PageEditor': 'ladowarki-do-elektronarzedzi',
      'admin product_feeds/api': 'ladowarki-do-elektronarzedzi',
    });
  });

  it('keeps each caller its own cap', () => {
    const long = 'a'.repeat(400);
    expect(Object.fromEntries(
      Object.entries(CALLERS).map(([site, options]) => [site, slugify(long, options).length]),
    )).toEqual({
      'product_feeds/feed-template-io': 80,
      'pim_ergonode/category-phase': 150,
      'catalog/catalog-admin': 160,
      'admin newsletter/TagsPage': 400,
      'admin cms/cms-template-layout': 180,
      'admin cms/BlockEditor': 180,
      'admin cms/PageEditor': 180,
      'admin product_feeds/api': 160,
    });
  });

  it('leaves no caller with a value ending in its separator', () => {
    // A word boundary sitting exactly on each cap, so every row is truncated
    // mid-separator. Six of the eight used to hand back a trailing one.
    for (const [site, options] of Object.entries(CALLERS)) {
      const cap = 'maxLength' in options ? options.maxLength : 40;
      const separator = 'separator' in options ? options.separator : '-';
      const produced = slugify(`${'a'.repeat(cap - 1)} bbb`, options);
      expect(produced.endsWith(separator), `${site} ends in its separator`).toBe(false);
    }
  });

  it('gives the two callers with a fallback theirs, and the six others nothing', () => {
    expect(slugify('///', CALLERS['product_feeds/feed-template-io'])).toBe('feed-template');
    expect(slugify('///', CALLERS['pim_ergonode/category-phase'])).toBe('category');
    expect(slugify('///', CALLERS['catalog/catalog-admin'])).toBe('');
    expect(slugify('///', CALLERS['admin newsletter/TagsPage'])).toBe('');
  });
});
