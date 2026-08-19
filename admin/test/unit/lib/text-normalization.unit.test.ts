import { describe, expect, it } from 'vitest';
import { normalize } from '../../../src/lib/text-normalization';

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
});
