import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { translatePlural } from '../../../../packages/modules/quote_requests/src/admin/plural';

/**
 * Review checkpoint B, fix 3 — counted days read naturally in both shipped
 * languages: "1 day / N days", "1 dzień / 2 dni / 5 dni", through the bundles'
 * plural suffixes. A `t` over the shipped bundle answers a missing key with the
 * kit's `scope.key` placeholder, as the real one does.
 */

function translator(language: 'en' | 'pl'): (key: string, params?: Record<string, string | number>) => string {
  const bundle = JSON.parse(
    readFileSync(resolve(process.cwd(), `../packages/modules/quote_requests/i18n/${language}.json`), 'utf8'),
  ) as Record<string, string>;
  return (key, params = {}) => {
    const template = bundle[key];
    if (template === undefined) return `quote_requests.${key}`;
    return template.replace(/\{(\w+)\}/g, (_m, name: string) => String(params[name] ?? `{${name}}`));
  };
}

describe('translatePlural', () => {
  it.each([
    [1, 'valid 1 day from sharing'],
    [2, 'valid 2 days from sharing'],
    [21, 'valid 21 days from sharing'],
  ])('en %i', (days, expected) => {
    expect(translatePlural(translator('en'), 'en', 'share.meta.validityDays', days, { days })).toBe(expected);
  });

  it.each([
    [1, 'ważna 1 dzień od udostępnienia'],
    [2, 'ważna 2 dni od udostępnienia'],
    [5, 'ważna 5 dni od udostępnienia'],
    [22, 'ważna 22 dni od udostępnienia'],
  ])('pl %i', (days, expected) => {
    expect(translatePlural(translator('pl'), 'pl', 'share.meta.validityDays', days, { days })).toBe(expected);
  });

  it('falls back to the `other` form a bundle does not carry', () => {
    // English has no `few`; Polish rules asked of the English bundle select it.
    expect(translatePlural(translator('en'), 'pl', 'validity.unshared.days', 3, { days: 3 })).toBe(
      'Valid for 3 days from the moment you share the quote.',
    );
  });
});
