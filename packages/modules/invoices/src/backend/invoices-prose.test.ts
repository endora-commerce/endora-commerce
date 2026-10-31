import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { INVOICES_PROSE_EN, invoicesProse } from './invoices-prose.js';

const bundle = (language: 'en' | 'pl'): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../../i18n/${language}.json`, import.meta.url), 'utf8')) as Record<
    string,
    string
  >;

describe('invoices backend prose', () => {
  it('keeps the in-code English tier equal to the English bundle', () => {
    const en = bundle('en');
    for (const [key, english] of Object.entries(INVOICES_PROSE_EN)) {
      expect(en[key], key).toBe(english);
    }
  });

  it('ships every sentence in Polish too', () => {
    const pl = bundle('pl');
    for (const key of Object.keys(INVOICES_PROSE_EN)) {
      expect(pl[key], key).toBeTypeOf('string');
    }
  });

  it('answers English when the translator throws or misses', async () => {
    await expect(
      invoicesProse(() => Promise.reject(new Error('unreachable')), 'lines.delivery', 'pl'),
    ).resolves.toBe('Delivery');
    await expect(
      invoicesProse(async (key) => `invoices.${key}`, 'lines.delivery', 'pl'),
    ).resolves.toBe('Delivery');
  });
});
