import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { manifest } from '../manifest.js';

/**
 * Issue #476 — the Settings screen reads a group's heading from the owning
 * module's bundle, `settingGroups.<group code>.name`
 * (`../admin/components/setting-label.ts`), and falls back to the English
 * name the manifest declared. `settings`' own three groups (`general`, `shop`,
 * `storefront`) shipped no key, so a Polish operator read them in English.
 *
 * Every group this module declares carries a non-empty name in both admin
 * languages, and the Polish one is not the English one copied over.
 */

const LANGUAGES = ['en', 'pl'] as const;

function bundle(language: (typeof LANGUAGES)[number]): Record<string, string> {
  return JSON.parse(
    readFileSync(new URL(`../../i18n/${language}.json`, import.meta.url), 'utf8'),
  ) as Record<string, string>;
}

const groups = manifest.settings?.groups ?? [];

describe('settings group names (issue #476)', () => {
  it('declares the groups this test is about', () => {
    // Positive control: an empty list would make every assertion below vacuous.
    expect(groups.map((g) => g.code)).toEqual(
      expect.arrayContaining(['general', 'shop', 'storefront']),
    );
  });

  it.each(LANGUAGES)('names every declared group in %s', (language) => {
    const entries = bundle(language);
    for (const group of groups) {
      expect(entries[`settingGroups.${group.code}.name`], `${language}: ${group.code}`).toEqual(
        expect.stringMatching(/\S/),
      );
    }
  });

  it('translates the Polish names rather than copying the English ones', () => {
    const en = bundle('en');
    const pl = bundle('pl');
    for (const group of groups) {
      const key = `settingGroups.${group.code}.name`;
      expect(pl[key], group.code).toEqual(expect.any(String));
      expect(pl[key], group.code).not.toBe(en[key]);
    }
  });
});
