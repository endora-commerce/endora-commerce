// Primary language↔country associations seeded for the Dictionary module
// (feature 017 / R6 / T009).
//
// Each row pins a Language as the primary choice for storefront locale
// auto-detection when a customer arrives with a Country signal (geolocation,
// shipping address). The "at most one primary per Country" invariant is
// enforced by a partial unique index in the migration.

export interface LanguageCountrySeedRow {
  languageCode: string;
  countryCode: string;
  isPrimary: boolean;
}

export const LANGUAGE_COUNTRY_SEED: readonly LanguageCountrySeedRow[] = [
  // pl-PL is primary for Poland.
  { languageCode: 'pl-PL', countryCode: 'PL', isPrimary: true },

  // en-US is primary for English-speaking markets the platform serves first.
  { languageCode: 'en-US', countryCode: 'US', isPrimary: true },
  { languageCode: 'en-US', countryCode: 'GB', isPrimary: true },
  { languageCode: 'en-US', countryCode: 'IE', isPrimary: true },
  { languageCode: 'en-US', countryCode: 'CA', isPrimary: true },
  { languageCode: 'en-US', countryCode: 'AU', isPrimary: true },
  { languageCode: 'en-US', countryCode: 'NZ', isPrimary: true },
];
