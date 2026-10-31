import { describe, expect, it } from 'vitest';
import { pluralForm, pluralKey } from '../../lib/i18n/plural';
import { commerce } from '../../lib/i18n/messages/commerce';

/**
 * Issue #85 — a counted sentence is keyed once per plural form and the form is
 * chosen by `Intl.PluralRules`, so a Polish page never reads "1 produktów" or
 * "5 produkty".
 */
describe('pluralForm', () => {
  it.each([
    [1, 'one'],
    [2, 'few'],
    [4, 'few'],
    [5, 'many'],
    [12, 'many'],
    [14, 'many'],
    [21, 'many'],
    [22, 'few'],
    [0, 'many'],
    [1.5, 'other'],
  ] as const)('Polish %s → %s', (n, form) => {
    expect(pluralForm(n, 'pl-PL')).toBe(form);
  });

  it.each([
    [1, 'one'],
    [2, 'other'],
    [0, 'other'],
  ] as const)('English %s → %s', (n, form) => {
    expect(pluralForm(n, 'en-US')).toBe(form);
  });

  it('maps a form outside the four (Arabic "two") to "other", and survives a bad tag', () => {
    expect(pluralForm(2, 'ar')).toBe('other');
    expect(pluralForm(1, 'not a locale!')).toBe('one');
  });

  it('builds the key of the form', () => {
    expect(pluralKey('commerce.cart.subheading', 3, 'pl-PL')).toBe('commerce.cart.subheading.few');
  });
});

describe('the commerce namespace', () => {
  it('writes every counted sentence in all four forms', () => {
    const keys = Object.keys(commerce['en-US']);
    const bases = new Set(
      keys.filter((k) => /\.(one|few|many|other)$/.test(k)).map((k) => k.replace(/\.(one|few|many|other)$/, '')),
    );
    expect(bases.size).toBeGreaterThan(0);
    for (const base of bases) {
      for (const form of ['one', 'few', 'many', 'other']) expect(keys).toContain(`${base}.${form}`);
    }
  });

  it('has no English value carrying a Polish diacritic', () => {
    const polish = Object.entries(commerce['en-US']).filter(([, v]) => /[ąćęłńóśźż]/i.test(v));
    expect(polish).toEqual([]);
  });
});
