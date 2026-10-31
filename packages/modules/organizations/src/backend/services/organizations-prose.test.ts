import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ORGANIZATIONS_PROSE_EN, organizationsProse } from './organizations-prose.js';

const bundle = (language: 'en' | 'pl'): Record<string, string> =>
  JSON.parse(
    readFileSync(new URL(`../../../i18n/${language}.json`, import.meta.url), 'utf8'),
  ) as Record<string, string>;

describe('organizations backend prose', () => {
  it('keeps the in-code English tier equal to the English bundle', () => {
    const en = bundle('en');
    for (const [key, english] of Object.entries(ORGANIZATIONS_PROSE_EN)) {
      expect(en[key], key).toBe(english);
    }
  });

  it('ships every sentence in Polish too', () => {
    const pl = bundle('pl');
    for (const key of Object.keys(ORGANIZATIONS_PROSE_EN)) {
      expect(pl[key], key).toBeTypeOf('string');
    }
  });

  it('answers English when the translator throws', async () => {
    await expect(
      organizationsProse(
        () => Promise.reject(new Error('bundle unreachable')),
        'notifications.newRegistration.title',
        'pl',
        { name: 'Acme' },
      ),
    ).resolves.toBe('New organization: Acme');
  });
});
