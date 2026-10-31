import { describe, expect, it } from 'vitest';

import { CURRENCY_SEED } from './currencies.js';
import { POLISH_TRANSLATION_SEED } from './translations.pl-PL.js';

/**
 * Issue #95 (`dictionaries`) — a currency's seeded `label` is its English name
 * and its Polish name is a `pl-PL` translation row. Two English labels carried
 * the currency's own diacritics (`Polish złoty`, `Icelandic króna`); they are
 * spelled as ISO 4217 spells them in English, and the Polish name a Polish
 * storefront shows is unchanged.
 */
const label = (code: string) => CURRENCY_SEED.find((row) => row.code === code)?.label;
const polish = (code: string) =>
  POLISH_TRANSLATION_SEED.find((row) => row.entryType === 'currency' && row.entryCode === code)?.label;

describe('currency seed — English labels, Polish translations', () => {
  it('labels the zloty and the krona in English', () => {
    expect(label('PLN')).toBe('Polish zloty');
    expect(label('ISK')).toBe('Icelandic krona');
  });

  it('keeps the Polish name of the zloty a Polish translation', () => {
    expect(polish('PLN')).toBe('Polski złoty');
  });
});
