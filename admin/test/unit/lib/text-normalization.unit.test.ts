import { describe, expect, it } from 'vitest';
import { normalize } from '../../../../packages/admin-shell/src/lib/text-normalization';

/**
 * `normalize` is `foldDiacritics` from `@endora-commerce/contracts` plus a trim since issue
 * #240 — the same fold the backend writes `organizations.name_search` with.
 * Before that this file carried its own map, and the two disagreed over 19 code
 * points without either author knowing, which is the defect the extraction ends.
 */

describe('normalize', () => {
  it('strips Polish diacritics', () => {
    expect(normalize('łatwy')).toBe('latwy');
    expect(normalize('Łódź')).toBe('lodz');
    expect(normalize('ąęćńóśźż')).toBe('aecnoszz');
  });

  it('strips French and Spanish accents', () => {
    expect(normalize('naïve')).toBe('naive');
    expect(normalize('café')).toBe('cafe');
    expect(normalize('niño')).toBe('nino');
  });

  it('strips German umlauts', () => {
    expect(normalize('über')).toBe('uber');
    expect(normalize('schön')).toBe('schon');
  });

  it('lowercases ASCII without modification', () => {
    expect(normalize('New Product')).toBe('new product');
    expect(normalize('IMPORT')).toBe('import');
  });

  it('returns the empty string for an empty input', () => {
    expect(normalize('')).toBe('');
  });

  it('trims surrounding whitespace', () => {
    // Issue #236 item 3. Four of the six call sites folded the query without
    // trimming it, so one leading space matched nothing — Postel's Law failing
    // on the surfaces built to be forgiving. The trim belongs here, once,
    // rather than at each caller that happens to remember it.
    expect(normalize('  Zamowienia  ')).toBe('zamowienia');
    expect(normalize('\t\nplatnosci ')).toBe('platnosci');
  });

  it('returns the empty string for a whitespace-only input', () => {
    expect(normalize('   ')).toBe('');
  });

  it('preserves digits, dashes, and spaces', () => {
    expect(normalize('Order #42-foo bar')).toBe('order #42-foo bar');
  });

  it('expands the ligatures and the sharp s, which the private map left standing', () => {
    // Fifteen of the nineteen code points that moved when this file adopted the
    // shared map. The private copy folded none of them: `Straße` stayed
    // `straße`, so typing `strasse` found nothing.
    expect(normalize('Straße')).toBe('strasse');
    expect(normalize('Æther')).toBe('aether');
    expect(normalize('Cœur')).toBe('coeur');
    expect(normalize('Þórshöfn')).toBe('thorshofn');
    expect(normalize('Ðanmark')).toBe('danmark');
  });

  it('folds a stroked letter that only appears after decomposition', () => {
    // The other four. `Ǿ` (U+01FE) decomposes to `Ø` + combining acute, so a
    // map applied *before* NFD — as the private copy applied it — never sees
    // the `Ø` the decomposition is about to expose, and folds it to `ø`.
    expect(normalize('Ǿre')).toBe('ore');
    expect(normalize('ǽsir')).toBe('aesir');
  });

  it('still folds every stroked letter the Polish and Nordic UI needs', () => {
    expect(normalize('Łódź')).toBe('lodz');
    expect(normalize('Øre')).toBe('ore');
    expect(normalize('Đakovo')).toBe('dakovo');
  });
});
