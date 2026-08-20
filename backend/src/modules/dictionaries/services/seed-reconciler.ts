// Boot-time seed reconciler for the Dictionary module
// (feature 017 / R6 / T011).
//
// Responsibilities (idempotent — safe to run on every backend boot):
//
//   1. Insert any currency from CURRENCY_SEED whose `code` is missing —
//      through `currencySeedPort`, because the table belongs to `currencies`
//      (feature 077, D-87: this step used to be a raw `insert into
//      "currencies"`, a write into another module's table that named no import
//      specifier and so crossed the boundary invisibly).
//      Currencies that already exist are NEVER updated by the reconciler;
//      the migration's defaults stand and operators may edit any field
//      via Admin UI without fear of being overwritten on the next boot.
//   2. Insert any country from COUNTRY_SEED whose `code` is missing.
//   3. Backfill `languages.native_label` ONLY when it is still the empty
//      string left by migration 038 — through `languageSeedPort`, for the same
//      reason step 1 goes through `currencySeedPort`. Once an operator (or this
//      reconciler) sets it to a non-empty value, future boots leave it alone.
//   4. Insert seeded translations for every (entry_type, entry_code,
//      language_code) row that doesn't already exist. Existing rows are
//      preserved verbatim (operators may edit; the reconciler will not
//      revert their changes).
//   5. Insert seeded language↔country associations for every
//      (language_code, country_code) row that doesn't already exist.
//
// All inserts are gated by an existence check that runs in the same
// EntityManager — there is no race condition because the reconciler is
// expected to run during plugin registration, before HTTP traffic.

import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CurrencyReadPort,
  CurrencySeedPort,
  LanguageReadPort,
  LanguageSeedPort,
} from '@b2b/contracts';
import { COUNTRY_SEED } from '../seed/countries.js';
import { CURRENCY_SEED } from '../seed/currencies.js';
import { POLISH_TRANSLATION_SEED } from '../seed/translations.pl-PL.js';
import { LANGUAGE_COUNTRY_SEED } from '../seed/language-countries.js';

export interface SeedReconcilerSummary {
  countriesInserted: number;
  currenciesInserted: number;
  languagesBackfilled: number;
  translationsInserted: number;
  languageCountriesInserted: number;
}

interface PresentCodes {
  countries: Set<string>;
  currencies: Set<string>;
  languages: Set<string>;
}

interface PresentTranslations {
  // Set of `${entryType}|${entryCode}|${languageCode}` keys.
  translations: Set<string>;
  // Set of `${languageCode}|${countryCode}` keys.
  languageCountries: Set<string>;
}

/**
 * The two tables this reconciler seeds that it does not own, and the read side
 * of both. Every one of them is a published port of the owning module — the
 * seam D-87's drain put where four raw statements used to be.
 */
export interface SeedReconcilerPorts {
  readonly currencySeed: CurrencySeedPort;
  readonly currencyRead: CurrencyReadPort;
  readonly languageSeed: LanguageSeedPort;
  readonly languageRead: LanguageReadPort;
}

export async function runDictionarySeedReconciler(
  emFactory: () => EntityManager,
  ports: SeedReconcilerPorts,
): Promise<SeedReconcilerSummary> {
  const em = emFactory();
  const conn = em.getConnection();
  const summary: SeedReconcilerSummary = {
    countriesInserted: 0,
    currenciesInserted: 0,
    languagesBackfilled: 0,
    translationsInserted: 0,
    languageCountriesInserted: 0,
  };

  // 1) Currencies — insert missing rows, then read the table back. The order
  // matters and is why the two are not one call: step 2 only sets a country's
  // `default_currency_code` when the currency is really there.
  summary.currenciesInserted = await ports.currencySeed.ensureSeeded(CURRENCY_SEED);
  const present = await loadPresentCodes(conn, ports);

  // 2) Countries — insert missing rows.
  for (const c of COUNTRY_SEED) {
    if (present.countries.has(c.code)) continue;
    // Defensive: only set defaultCurrencyCode if the currency exists.
    const defaultCurrency =
      c.defaultCurrencyCode && present.currencies.has(c.defaultCurrencyCode)
        ? c.defaultCurrencyCode
        : null;
    await conn.execute(
      `insert into "countries"
         ("code","alpha3_code","numeric_code","label","region","subregion",
          "dial_code","is_eu_member","default_currency_code",
          "is_active","is_default","sort_order","created_at","updated_at")
       values (?,?,?,?,?,?,?,?,?,?,?,?,now(),now())`,
      [
        c.code,
        c.alpha3Code,
        c.numericCode,
        c.label,
        c.region,
        c.subregion ?? null,
        c.dialCode ?? null,
        c.isEuMember ?? false,
        defaultCurrency,
        c.isActive ?? true,
        c.isDefault ?? false,
        c.sortOrder ?? 0,
      ],
    );
    present.countries.add(c.code);
    summary.countriesInserted += 1;
  }

  // 3) Languages — backfill `native_label` ONLY when still the empty
  // string left by the migration. The seed only knows the two languages
  // already created by migration 012.
  summary.languagesBackfilled = await ports.languageSeed.backfillNativeLabels([
    { code: 'en-US', nativeLabel: 'English (US)' },
    { code: 'pl-PL', nativeLabel: 'Polski' },
  ]);

  // 4) Translations + 5) language↔country — load the existing keysets,
  // then insert only what's missing.
  const presentRels = await loadPresentTranslations(conn);

  for (const t of POLISH_TRANSLATION_SEED) {
    const parentSet =
      t.entryType === 'country'
        ? present.countries
        : t.entryType === 'currency'
          ? present.currencies
          : present.languages;
    if (!parentSet.has(t.entryCode)) continue;
    if (!present.languages.has(t.languageCode)) continue;
    const key = `${t.entryType}|${t.entryCode}|${t.languageCode}`;
    if (presentRels.translations.has(key)) continue;
    await conn.execute(
      `insert into "dictionary_translations"
         ("entry_type","entry_code","language_code","label","created_at","updated_at")
       values (?,?,?,?,now(),now())`,
      [t.entryType, t.entryCode, t.languageCode, t.label],
    );
    presentRels.translations.add(key);
    summary.translationsInserted += 1;
  }

  for (const lc of LANGUAGE_COUNTRY_SEED) {
    if (!present.languages.has(lc.languageCode)) continue;
    if (!present.countries.has(lc.countryCode)) continue;
    const key = `${lc.languageCode}|${lc.countryCode}`;
    if (presentRels.languageCountries.has(key)) continue;
    await conn.execute(
      `insert into "language_countries"
         ("language_code","country_code","is_primary","created_at")
       values (?,?,?,now())`,
      [lc.languageCode, lc.countryCode, lc.isPrimary],
    );
    presentRels.languageCountries.add(key);
    summary.languageCountriesInserted += 1;
  }

  return summary;
}

type ConnectionLike = ReturnType<EntityManager['getConnection']>;

/**
 * `countries` is this module's own table and is read in SQL; the other two are
 * read through their owners' published read ports, which is what retires the
 * `select "code" from "currencies"` / `"languages"` pair D-87 seeded.
 */
async function loadPresentCodes(
  conn: ConnectionLike,
  ports: SeedReconcilerPorts,
): Promise<PresentCodes> {
  const [countries, currencies, languages] = await Promise.all([
    conn.execute(`select "code" from "countries"`) as Promise<Array<{ code: string }>>,
    ports.currencyRead.list(),
    ports.languageRead.list(),
  ]);
  return {
    countries: new Set(countries.map((r) => r.code)),
    currencies: new Set(currencies.map((r) => r.code)),
    languages: new Set(languages.map((r) => r.code)),
  };
}

async function loadPresentTranslations(conn: ConnectionLike): Promise<PresentTranslations> {
  const [translations, languageCountries] = await Promise.all([
    conn.execute(
      `select "entry_type","entry_code","language_code" from "dictionary_translations"`,
    ) as Promise<Array<{ entry_type: string; entry_code: string; language_code: string }>>,
    conn.execute(
      `select "language_code","country_code" from "language_countries"`,
    ) as Promise<Array<{ language_code: string; country_code: string }>>,
  ]);
  return {
    translations: new Set(
      translations.map((r) => `${r.entry_type}|${r.entry_code}|${r.language_code}`),
    ),
    languageCountries: new Set(
      languageCountries.map((r) => `${r.language_code}|${r.country_code}`),
    ),
  };
}
