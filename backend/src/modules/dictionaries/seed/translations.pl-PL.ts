// Polish (`pl-PL`) seed translations for the Dictionary module
// (feature 017 / R6 / T008).
//
// Covers the active-by-default subset of the country catalogue plus the
// seeded currencies and languages so a fresh-install Polish-locale
// storefront renders idiomatic Polish names without operator action.
// The reconciler is idempotent — operator edits to existing translation
// rows are not overwritten.

import type { DictionaryEntryType } from '@b2b/contracts';

export interface TranslationSeedRow {
  entryType: DictionaryEntryType;
  entryCode: string;
  /** The locale this translation is FOR. */
  languageCode: string;
  label: string;
}

export const POLISH_TRANSLATION_SEED: readonly TranslationSeedRow[] = [
  // ── Languages ─────────────────────────────────────────────────────
  { entryType: 'language', entryCode: 'en-US', languageCode: 'pl-PL', label: 'Angielski (US)' },
  { entryType: 'language', entryCode: 'pl-PL', languageCode: 'pl-PL', label: 'Polski' },

  // ── Currencies ────────────────────────────────────────────────────
  { entryType: 'currency', entryCode: 'PLN', languageCode: 'pl-PL', label: 'Polski złoty' },
  { entryType: 'currency', entryCode: 'EUR', languageCode: 'pl-PL', label: 'Euro' },
  { entryType: 'currency', entryCode: 'USD', languageCode: 'pl-PL', label: 'Dolar amerykański' },
  { entryType: 'currency', entryCode: 'GBP', languageCode: 'pl-PL', label: 'Funt brytyjski' },
  { entryType: 'currency', entryCode: 'CHF', languageCode: 'pl-PL', label: 'Frank szwajcarski' },
  { entryType: 'currency', entryCode: 'CZK', languageCode: 'pl-PL', label: 'Korona czeska' },
  { entryType: 'currency', entryCode: 'HUF', languageCode: 'pl-PL', label: 'Forint węgierski' },
  { entryType: 'currency', entryCode: 'NOK', languageCode: 'pl-PL', label: 'Korona norweska' },
  { entryType: 'currency', entryCode: 'SEK', languageCode: 'pl-PL', label: 'Korona szwedzka' },
  { entryType: 'currency', entryCode: 'DKK', languageCode: 'pl-PL', label: 'Korona duńska' },
  { entryType: 'currency', entryCode: 'JPY', languageCode: 'pl-PL', label: 'Jen japoński' },
  { entryType: 'currency', entryCode: 'CNY', languageCode: 'pl-PL', label: 'Juan chiński' },

  // ── Countries (everyday-commerce subset) ──────────────────────────
  { entryType: 'country', entryCode: 'PL', languageCode: 'pl-PL', label: 'Polska' },
  { entryType: 'country', entryCode: 'AT', languageCode: 'pl-PL', label: 'Austria' },
  { entryType: 'country', entryCode: 'BE', languageCode: 'pl-PL', label: 'Belgia' },
  { entryType: 'country', entryCode: 'BG', languageCode: 'pl-PL', label: 'Bułgaria' },
  { entryType: 'country', entryCode: 'HR', languageCode: 'pl-PL', label: 'Chorwacja' },
  { entryType: 'country', entryCode: 'CY', languageCode: 'pl-PL', label: 'Cypr' },
  { entryType: 'country', entryCode: 'CZ', languageCode: 'pl-PL', label: 'Czechy' },
  { entryType: 'country', entryCode: 'DK', languageCode: 'pl-PL', label: 'Dania' },
  { entryType: 'country', entryCode: 'EE', languageCode: 'pl-PL', label: 'Estonia' },
  { entryType: 'country', entryCode: 'FI', languageCode: 'pl-PL', label: 'Finlandia' },
  { entryType: 'country', entryCode: 'FR', languageCode: 'pl-PL', label: 'Francja' },
  { entryType: 'country', entryCode: 'DE', languageCode: 'pl-PL', label: 'Niemcy' },
  { entryType: 'country', entryCode: 'GR', languageCode: 'pl-PL', label: 'Grecja' },
  { entryType: 'country', entryCode: 'HU', languageCode: 'pl-PL', label: 'Węgry' },
  { entryType: 'country', entryCode: 'IE', languageCode: 'pl-PL', label: 'Irlandia' },
  { entryType: 'country', entryCode: 'IT', languageCode: 'pl-PL', label: 'Włochy' },
  { entryType: 'country', entryCode: 'LV', languageCode: 'pl-PL', label: 'Łotwa' },
  { entryType: 'country', entryCode: 'LT', languageCode: 'pl-PL', label: 'Litwa' },
  { entryType: 'country', entryCode: 'LU', languageCode: 'pl-PL', label: 'Luksemburg' },
  { entryType: 'country', entryCode: 'MT', languageCode: 'pl-PL', label: 'Malta' },
  { entryType: 'country', entryCode: 'NL', languageCode: 'pl-PL', label: 'Holandia' },
  { entryType: 'country', entryCode: 'PT', languageCode: 'pl-PL', label: 'Portugalia' },
  { entryType: 'country', entryCode: 'RO', languageCode: 'pl-PL', label: 'Rumunia' },
  { entryType: 'country', entryCode: 'SK', languageCode: 'pl-PL', label: 'Słowacja' },
  { entryType: 'country', entryCode: 'SI', languageCode: 'pl-PL', label: 'Słowenia' },
  { entryType: 'country', entryCode: 'ES', languageCode: 'pl-PL', label: 'Hiszpania' },
  { entryType: 'country', entryCode: 'SE', languageCode: 'pl-PL', label: 'Szwecja' },
  { entryType: 'country', entryCode: 'CH', languageCode: 'pl-PL', label: 'Szwajcaria' },
  { entryType: 'country', entryCode: 'GB', languageCode: 'pl-PL', label: 'Wielka Brytania' },
  { entryType: 'country', entryCode: 'NO', languageCode: 'pl-PL', label: 'Norwegia' },
  { entryType: 'country', entryCode: 'IS', languageCode: 'pl-PL', label: 'Islandia' },
  { entryType: 'country', entryCode: 'UA', languageCode: 'pl-PL', label: 'Ukraina' },
  { entryType: 'country', entryCode: 'TR', languageCode: 'pl-PL', label: 'Turcja' },
  { entryType: 'country', entryCode: 'US', languageCode: 'pl-PL', label: 'Stany Zjednoczone' },
  { entryType: 'country', entryCode: 'CA', languageCode: 'pl-PL', label: 'Kanada' },
  { entryType: 'country', entryCode: 'MX', languageCode: 'pl-PL', label: 'Meksyk' },
  { entryType: 'country', entryCode: 'BR', languageCode: 'pl-PL', label: 'Brazylia' },
  { entryType: 'country', entryCode: 'CN', languageCode: 'pl-PL', label: 'Chiny' },
  { entryType: 'country', entryCode: 'JP', languageCode: 'pl-PL', label: 'Japonia' },
  { entryType: 'country', entryCode: 'KR', languageCode: 'pl-PL', label: 'Korea Południowa' },
  { entryType: 'country', entryCode: 'IN', languageCode: 'pl-PL', label: 'Indie' },
  { entryType: 'country', entryCode: 'IL', languageCode: 'pl-PL', label: 'Izrael' },
  { entryType: 'country', entryCode: 'AE', languageCode: 'pl-PL', label: 'Zjednoczone Emiraty Arabskie' },
  { entryType: 'country', entryCode: 'AU', languageCode: 'pl-PL', label: 'Australia' },
  { entryType: 'country', entryCode: 'NZ', languageCode: 'pl-PL', label: 'Nowa Zelandia' },
  { entryType: 'country', entryCode: 'ZA', languageCode: 'pl-PL', label: 'Republika Południowej Afryki' },
];
