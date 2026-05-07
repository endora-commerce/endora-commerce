import { describe, expect, it } from 'vitest';
import { normalize } from '../../../src/lib/admin-actions/normalize';

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

  it('preserves digits, dashes, and spaces', () => {
    expect(normalize('Order #42-foo bar')).toBe('order #42-foo bar');
  });
});
