// The shipped language catalogue is reference data nobody executes, so nothing
// but a test can say it is well-formed. Every assertion here is about the data
// file's own shape: a row the admin contract would refuse, a country code the
// reconciler could never link, or a row that would make a second language
// "active" on a storefront are all silent at boot.

import { describe, expect, it } from 'vitest';
import { createDictionaryLanguageRequestSchema } from '@endora-commerce/contracts';
import { COUNTRY_SEED } from './countries.js';
import { LANGUAGE_COUNTRY_SEED } from './language-countries.js';
import {
  LANGUAGE_CATALOGUE,
  LANGUAGE_CATALOGUE_SORT_BASE,
  languageCatalogueCountryLinks,
  languageCatalogueSeedRows,
} from './languages.js';

describe('language catalogue — the shipped ISO 639-1 reference data', () => {
  it('lists every ISO 639-1 language once, by its two-letter code', () => {
    const codes = LANGUAGE_CATALOGUE.map((row) => row.code);
    expect(codes).toHaveLength(183);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[a-z]{2}$/);
    // Ordered by code, so a reviewer can find a row and a diff stays local.
    expect(codes).toEqual([...codes].sort());
    // The codes ISO 639-1 has withdrawn are not offered.
    for (const withdrawn of ['bh', 'in', 'iw', 'ji', 'jw', 'mo', 'sh']) {
      expect(codes).not.toContain(withdrawn);
    }
  });

  it('never restates the two regional languages the init migration creates', () => {
    const codes = new Set(LANGUAGE_CATALOGUE.map((row) => row.code));
    expect(codes.has('en-US')).toBe(false);
    expect(codes.has('pl-PL')).toBe(false);
  });

  it('gives every row a label and a native label the admin contract accepts', () => {
    for (const row of LANGUAGE_CATALOGUE) {
      const parsed = createDictionaryLanguageRequestSchema.safeParse({
        code: row.code,
        label: row.label,
        nativeLabel: row.nativeLabel,
        isRtl: row.isRtl ?? false,
      });
      expect(parsed.success, `${row.code} is not a valid dictionary language`).toBe(true);
    }
    const byCode = new Map(LANGUAGE_CATALOGUE.map((row) => [row.code, row]));
    expect(byCode.get('de')).toMatchObject({ label: 'German', nativeLabel: 'Deutsch' });
    expect(byCode.get('pl')).toMatchObject({ label: 'Polish', nativeLabel: 'Polski' });
    expect(byCode.get('ja')).toMatchObject({ label: 'Japanese', nativeLabel: '日本語' });
  });

  it('marks the right-to-left languages and no others', () => {
    const rtl = LANGUAGE_CATALOGUE.filter((row) => row.isRtl === true).map((row) => row.code);
    expect(rtl).toEqual(['ae', 'ar', 'dv', 'fa', 'he', 'ks', 'ps', 'sd', 'ug', 'ur', 'yi']);
  });

  it('maps each language to ISO 3166-1 alpha-2 countries, sorted and unique', () => {
    for (const row of LANGUAGE_CATALOGUE) {
      for (const country of row.countries) expect(country).toMatch(/^[A-Z]{2}$/);
      expect(new Set(row.countries).size, `${row.code} repeats a country`).toBe(
        row.countries.length,
      );
      expect(row.countries, `${row.code} countries are not sorted`).toEqual(
        [...row.countries].sort(),
      );
    }
    const byCode = new Map(LANGUAGE_CATALOGUE.map((row) => [row.code, row.countries]));
    expect(byCode.get('pl')).toEqual(['PL']);
    expect(byCode.get('de')).toEqual(['AT', 'BE', 'CH', 'DE', 'IT', 'LI', 'LU']);
    expect(byCode.get('rm')).toEqual(['CH']);
    expect(byCode.get('pt')).toEqual(
      expect.arrayContaining(['AO', 'BR', 'MZ', 'PT']),
    );
    // A constructed language is used by no country, and says so with an empty list.
    expect(byCode.get('eo')).toEqual([]);
  });

  it('reaches every country the dictionary ships, so no seeded country is left without a language', () => {
    const mapped = new Set(LANGUAGE_CATALOGUE.flatMap((row) => row.countries));
    const unreached = COUNTRY_SEED.map((country) => country.code).filter(
      (code) => !mapped.has(code),
    );
    expect(unreached).toEqual([]);
  });

  it('seeds every catalogue row after the two shipped languages, in label order', () => {
    const rows = languageCatalogueSeedRows();
    expect(rows).toHaveLength(LANGUAGE_CATALOGUE.length);
    const sortOrders = rows.map((row) => row.sortOrder);
    expect(Math.min(...sortOrders)).toBe(LANGUAGE_CATALOGUE_SORT_BASE);
    expect(new Set(sortOrders).size).toBe(sortOrders.length);
    const byOrder = [...rows].sort((a, b) => a.sortOrder - b.sortOrder).map((row) => row.label);
    expect(byOrder).toEqual([...byOrder].sort((a, b) => a.localeCompare(b, 'en')));
    // The seed row carries no activation: the port inserts every row inactive.
    for (const row of rows) expect(row).not.toHaveProperty('isActive');
  });

  it('derives one non-primary link per language and country, colliding with no shipped primary', () => {
    const links = languageCatalogueCountryLinks();
    const pairs = LANGUAGE_CATALOGUE.reduce((sum, row) => sum + row.countries.length, 0);
    expect(links).toHaveLength(pairs);
    expect(links.every((link) => link.isPrimary === false)).toBe(true);
    const shipped = new Set(
      LANGUAGE_COUNTRY_SEED.map((link) => `${link.languageCode}|${link.countryCode}`),
    );
    expect(links.some((link) => shipped.has(`${link.languageCode}|${link.countryCode}`))).toBe(
      false,
    );
  });
});
