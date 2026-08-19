import { createHash } from 'node:crypto';

import { normalizeOrganizationName } from '@b2b/contracts';
import { describe, expect, it } from 'vitest';

/**
 * Characterisation test for `normalizeOrganizationName` (issue #240).
 *
 * **This test pins behaviour, not intent.** `normalizeOrganizationName` writes
 * a *persisted* column — `organizations.name_search`, filled by the entity's
 * `@BeforeCreate` / `@BeforeUpdate` hooks — and two readers match against that
 * column, one of them with `$like`. Writer and readers must agree, so a fold
 * that changes its answer for one character does not "improve search": it
 * silently stops matching every row written before the change, with no error
 * anywhere.
 *
 * Issue #240 extracts the diacritic fold out of this function into a shared,
 * neutrally-named export so `backend/`, `admin/` and `storefront/` can reach
 * one implementation. The extraction is only safe if it is **output-identical
 * for every input**, and this file is the proof: every expectation below is a
 * literal recorded from the pre-extraction implementation, never recomputed by
 * calling the fold a second time. It must pass unchanged before and after.
 *
 * Do not update an expectation here to make a change pass. A red line means the
 * fold moved, and moving it is a data migration over `name_search`, not a
 * refactoring detail.
 */

/**
 * Every key of the non-decomposing Latin map, as it stood before the
 * extraction. NFD leaves each of these exactly where it was — that is what
 * "non-decomposing" means — so each one is a character the naive
 * `normalize('NFD').replace(/\p{Diacritic}/gu, '')` one-liner cannot touch.
 */
const NON_DECOMPOSING_LATIN_CASES: ReadonlyArray<readonly [string, string]> = [
  ['Ł', 'l'],
  ['ł', 'l'],
  ['Ø', 'o'],
  ['ø', 'o'],
  ['Đ', 'd'],
  ['đ', 'd'],
  ['Ð', 'd'],
  ['ð', 'd'],
  ['Þ', 'th'],
  ['þ', 'th'],
  ['ß', 'ss'],
  ['Æ', 'ae'],
  ['æ', 'ae'],
  ['Œ', 'oe'],
  ['œ', 'oe'],
];

/**
 * The full Polish alphabet's nine diacritics, in both cases. Eight of them do
 * decompose and are handled by the NFD strip; `ł` is the one that does not,
 * which is the whole reason the map exists.
 */
const POLISH_CASES: ReadonlyArray<readonly [string, string]> = [
  ['ą', 'a'],
  ['ć', 'c'],
  ['ę', 'e'],
  ['ł', 'l'],
  ['ń', 'n'],
  ['ó', 'o'],
  ['ś', 's'],
  ['ź', 'z'],
  ['ż', 'z'],
  ['Ą', 'a'],
  ['Ć', 'c'],
  ['Ę', 'e'],
  ['Ł', 'l'],
  ['Ń', 'n'],
  ['Ó', 'o'],
  ['Ś', 's'],
  ['Ź', 'z'],
  ['Ż', 'z'],
];

describe('normalizeOrganizationName — characterisation (issue #240)', () => {
  it.each(NON_DECOMPOSING_LATIN_CASES)(
    'folds the non-decomposing letter %s to %s',
    (input, expected) => {
      expect(normalizeOrganizationName(input)).toBe(expected);
    },
  );

  it.each(POLISH_CASES)('folds the Polish letter %s to %s', (input, expected) => {
    expect(normalizeOrganizationName(input)).toBe(expected);
  });

  it('folds real Polish organisation names', () => {
    expect(normalizeOrganizationName('Łatwy Szablon')).toBe('latwy szablon');
    expect(normalizeOrganizationName('Zakład Przetwórstwa Żywności')).toBe(
      'zaklad przetworstwa zywnosci',
    );
    expect(normalizeOrganizationName('Żółć Sp. z o.o.')).toBe('zolc sp. z o.o.');
    expect(normalizeOrganizationName('Łódź Kaliska S.A.')).toBe('lodz kaliska s.a.');
  });

  it('folds the mixed-script names the map was written for', () => {
    expect(normalizeOrganizationName('Ærøskøbing Handel')).toBe('aeroskobing handel');
    expect(normalizeOrganizationName('Straße 1 GmbH')).toBe('strasse 1 gmbh');
    expect(normalizeOrganizationName('Þórshöfn Ehf')).toBe('thorshofn ehf');
    expect(normalizeOrganizationName('Đakovo d.o.o.')).toBe('dakovo d.o.o.');
    expect(normalizeOrganizationName('Cœur Français')).toBe('coeur francais');
  });

  it('lowercases mixed case without touching anything else', () => {
    expect(normalizeOrganizationName('AcMe HoLdInG')).toBe('acme holding');
    expect(normalizeOrganizationName('ACME')).toBe('acme');
    expect(normalizeOrganizationName('acme')).toBe('acme');
  });

  it('collapses runs of internal whitespace to one space', () => {
    expect(normalizeOrganizationName('Acme    Holding')).toBe('acme holding');
    expect(normalizeOrganizationName('Acme\tHolding')).toBe('acme holding');
    expect(normalizeOrganizationName('Acme\n\nHolding')).toBe('acme holding');
    expect(normalizeOrganizationName('a  b   c')).toBe('a b c');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeOrganizationName('  Acme  ')).toBe('acme');
    expect(normalizeOrganizationName('\t\nAcme Holding \r\n')).toBe('acme holding');
  });

  it('returns the empty string for an empty or whitespace-only input', () => {
    expect(normalizeOrganizationName('')).toBe('');
    expect(normalizeOrganizationName('   ')).toBe('');
    expect(normalizeOrganizationName('\t\n\r ')).toBe('');
  });

  it('returns the empty string for a string of only combining marks', () => {
    // U+0301 acute, U+0308 diaeresis, U+030C caron — bases removed, so the
    // strip has nothing left to attach to and the whole input disappears.
    expect(normalizeOrganizationName('́̈̌')).toBe('');
    expect(normalizeOrganizationName('̀́̂̃')).toBe('');
  });

  it('leaves a string of only precomposed diacritics as its folded bases', () => {
    expect(normalizeOrganizationName('ąćęłńóśźż')).toBe('acelnoszz');
    expect(normalizeOrganizationName('áàâãäå')).toBe('aaaaaa');
  });

  it('preserves digits, punctuation and non-Latin scripts as they were', () => {
    expect(normalizeOrganizationName('Order #42-foo_bar')).toBe('order #42-foo_bar');
    expect(normalizeOrganizationName('ООО Ромашка')).toBe('ооо ромашка');
    expect(normalizeOrganizationName('株式会社')).toBe('株式会社');
  });

  it('is idempotent — folding a folded name changes nothing', () => {
    for (const input of ['Łódź  Kaliska ', 'Straße 1 GmbH', 'Ærøskøbing', '   ']) {
      const once = normalizeOrganizationName(input);
      expect(normalizeOrganizationName(once)).toBe(once);
    }
  });

  /**
   * A golden digest over every code point the fold can plausibly meet.
   *
   * The cases above are readable and cover what a reviewer would think to
   * check; this covers what nobody would. It sweeps ASCII, Latin-1 Supplement,
   * Latin Extended-A and -B, the combining-marks block and Latin Extended
   * Additional, folds each code point on its own, and hashes the concatenation.
   * The digest is a **recorded literal**: it was produced by the implementation
   * as it stood before issue #240 moved a line, so a single character folding
   * differently after the move turns this red even though no named case above
   * mentions it.
   *
   * If it goes red, do not re-record it. Print the first differing code point
   * and decide whether the change to `name_search` is one somebody approved.
   */
  it('folds every Latin code point exactly as it did before the extraction', () => {
    const ranges: ReadonlyArray<readonly [number, number]> = [
      [0x0020, 0x007e], // ASCII printable
      [0x00a0, 0x00ff], // Latin-1 Supplement
      [0x0100, 0x017f], // Latin Extended-A
      [0x0180, 0x024f], // Latin Extended-B
      [0x0300, 0x036f], // Combining Diacritical Marks
      [0x1e00, 0x1eff], // Latin Extended Additional
    ];
    const folded: string[] = [];
    for (const [from, to] of ranges) {
      for (let point = from; point <= to; point += 1) {
        folded.push(
          `${point.toString(16)}:${normalizeOrganizationName(String.fromCodePoint(point))}`,
        );
      }
    }
    const digest = createHash('sha256').update(folded.join('\n')).digest('hex');
    expect(digest).toBe('9c1087d12e9728f8c96c9329612e65a3836986c88e6c9e8079a5307dd6457eaf');
  });
});
