import { z } from 'zod';
import { isoDateTimeSchema } from './common.js';

/**
 * Dictionary contracts (feature 017).
 *
 * Single source of truth for the platform-wide registry of Countries, Currencies,
 * and Languages, plus per-entry display-label translations and the typed
 * cross-module DictionaryValidator port (see contracts/dictionary-validation.contract.md).
 *
 * Currency and Language codes follow the same regexes used by the legacy
 * `i18n.ts` module (BCP-47 subset + ISO 4217). Country codes are ISO 3166-1
 * alpha-2 — the convention already adopted by Address, Tax, Warehouse, and
 * Organisation.
 */

const COUNTRY_CODE = z
  .string()
  .regex(/^[A-Z]{2}$/, 'ISO 3166-1 alpha-2 country code');

const CURRENCY_CODE = z
  .string()
  .regex(/^[A-Z]{3}$/, 'ISO 4217 currency code');

const LANGUAGE_CODE = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, 'BCP-47 language tag');

const ALPHA3_CODE = z
  .string()
  .regex(/^[A-Z]{3}$/, 'ISO 3166-1 alpha-3 country code');

const NUMERIC_CODE = z
  .string()
  .regex(/^[0-9]{3}$/, 'ISO 3166-1 numeric country code (zero-padded)');

const DIAL_CODE = z
  .string()
  .regex(/^\+\d{1,4}$/, 'International dial code prefixed with "+"');

export const REGIONS = [
  'Africa',
  'Americas',
  'Asia',
  'Europe',
  'Oceania',
  'Antarctic',
] as const;
export const regionSchema = z.enum(REGIONS);
export type Region = z.infer<typeof regionSchema>;

export const symbolPositionSchema = z.enum(['prefix', 'suffix']);
export type SymbolPosition = z.infer<typeof symbolPositionSchema>;

export const dictionaryEntryTypeSchema = z.enum(['country', 'currency', 'language']);
export type DictionaryEntryType = z.infer<typeof dictionaryEntryTypeSchema>;

// ---------------------------------------------------------------------------
// Country
// ---------------------------------------------------------------------------

export const countrySchema = z.object({
  code: COUNTRY_CODE,
  alpha3Code: ALPHA3_CODE,
  numericCode: NUMERIC_CODE,
  label: z.string().min(1).max(120),
  region: regionSchema,
  subregion: z.string().max(64).nullable(),
  dialCode: DIAL_CODE.nullable(),
  isEuMember: z.boolean(),
  defaultCurrencyCode: CURRENCY_CODE.nullable(),
  isActive: z.boolean(),
  isDefault: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Country = z.infer<typeof countrySchema>;

export const createCountryRequestSchema = z.object({
  code: COUNTRY_CODE,
  alpha3Code: ALPHA3_CODE,
  numericCode: NUMERIC_CODE,
  label: z.string().min(1).max(120),
  region: regionSchema,
  subregion: z.string().max(64).optional(),
  dialCode: DIAL_CODE.optional(),
  isEuMember: z.boolean().optional(),
  defaultCurrencyCode: CURRENCY_CODE.optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});
export type CreateCountryRequest = z.infer<typeof createCountryRequestSchema>;

export const updateCountryRequestSchema = z.object({
  alpha3Code: ALPHA3_CODE.optional(),
  numericCode: NUMERIC_CODE.optional(),
  label: z.string().min(1).max(120).optional(),
  region: regionSchema.optional(),
  subregion: z.string().max(64).nullable().optional(),
  dialCode: DIAL_CODE.nullable().optional(),
  isEuMember: z.boolean().optional(),
  defaultCurrencyCode: CURRENCY_CODE.nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});
export type UpdateCountryRequest = z.infer<typeof updateCountryRequestSchema>;

// ---------------------------------------------------------------------------
// Currency (extended) — backwards compatible with i18n.ts `currencySchema`
// ---------------------------------------------------------------------------

export const dictionaryCurrencySchema = z.object({
  code: CURRENCY_CODE,
  label: z.string().min(1).max(64),
  symbol: z.string().min(1).max(8),
  symbolPosition: symbolPositionSchema,
  decimalPlaces: z.number().int().min(0).max(6),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type DictionaryCurrency = z.infer<typeof dictionaryCurrencySchema>;

export const createDictionaryCurrencyRequestSchema = z.object({
  code: CURRENCY_CODE,
  label: z.string().min(1).max(64),
  symbol: z.string().min(1).max(8),
  symbolPosition: symbolPositionSchema.optional(),
  decimalPlaces: z.number().int().min(0).max(6).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});
export type CreateDictionaryCurrencyRequest = z.infer<typeof createDictionaryCurrencyRequestSchema>;

export const updateDictionaryCurrencyRequestSchema = z.object({
  label: z.string().min(1).max(64).optional(),
  symbol: z.string().min(1).max(8).optional(),
  symbolPosition: symbolPositionSchema.optional(),
  decimalPlaces: z.number().int().min(0).max(6).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});
export type UpdateDictionaryCurrencyRequest = z.infer<typeof updateDictionaryCurrencyRequestSchema>;

// ---------------------------------------------------------------------------
// Language (extended) — backwards compatible with i18n.ts `languageSchema`
// ---------------------------------------------------------------------------

export const dictionaryLanguageSchema = z.object({
  code: LANGUAGE_CODE,
  label: z.string().min(1).max(64),
  nativeLabel: z.string().min(1).max(64),
  isRtl: z.boolean(),
  fallbackCode: LANGUAGE_CODE.nullable(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  countries: z.array(COUNTRY_CODE),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type DictionaryLanguage = z.infer<typeof dictionaryLanguageSchema>;

export const createDictionaryLanguageRequestSchema = z.object({
  code: LANGUAGE_CODE,
  label: z.string().min(1).max(64),
  nativeLabel: z.string().min(1).max(64),
  isRtl: z.boolean().optional(),
  fallbackCode: LANGUAGE_CODE.optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});
export type CreateDictionaryLanguageRequest = z.infer<typeof createDictionaryLanguageRequestSchema>;

export const updateDictionaryLanguageRequestSchema = z.object({
  label: z.string().min(1).max(64).optional(),
  nativeLabel: z.string().min(1).max(64).optional(),
  isRtl: z.boolean().optional(),
  fallbackCode: LANGUAGE_CODE.nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});
export type UpdateDictionaryLanguageRequest = z.infer<typeof updateDictionaryLanguageRequestSchema>;

// ---------------------------------------------------------------------------
// Translations
// ---------------------------------------------------------------------------

export const dictionaryTranslationSchema = z.object({
  entryType: dictionaryEntryTypeSchema,
  entryCode: z.string().min(1).max(12),
  languageCode: LANGUAGE_CODE,
  label: z.string().min(1).max(160),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type DictionaryTranslation = z.infer<typeof dictionaryTranslationSchema>;

export const upsertTranslationRequestSchema = z.object({
  label: z.string().min(1).max(160),
});
export type UpsertTranslationRequest = z.infer<typeof upsertTranslationRequestSchema>;

// ---------------------------------------------------------------------------
// Language ↔ Country association
// ---------------------------------------------------------------------------

export const languageCountrySchema = z.object({
  languageCode: LANGUAGE_CODE,
  countryCode: COUNTRY_CODE,
  isPrimary: z.boolean(),
  createdAt: isoDateTimeSchema,
});
export type LanguageCountry = z.infer<typeof languageCountrySchema>;

export const upsertLanguageCountryRequestSchema = z.object({
  isPrimary: z.boolean().optional(),
});
export type UpsertLanguageCountryRequest = z.infer<typeof upsertLanguageCountryRequestSchema>;

// ---------------------------------------------------------------------------
// Pagination wrappers (admin list endpoints)
// ---------------------------------------------------------------------------

const paginationMetaSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(250),
  total: z.number().int().min(0),
});

export const dictionaryCountriesPageResponseSchema = z.object({
  data: z.array(countrySchema),
  pagination: paginationMetaSchema,
});
export type DictionaryCountriesPageResponse = z.infer<typeof dictionaryCountriesPageResponseSchema>;

export const dictionaryCurrenciesPageResponseSchema = z.object({
  data: z.array(dictionaryCurrencySchema),
  pagination: paginationMetaSchema,
});
export type DictionaryCurrenciesPageResponse = z.infer<typeof dictionaryCurrenciesPageResponseSchema>;

export const dictionaryLanguagesPageResponseSchema = z.object({
  data: z.array(dictionaryLanguageSchema),
  pagination: paginationMetaSchema,
});
export type DictionaryLanguagesPageResponse = z.infer<typeof dictionaryLanguagesPageResponseSchema>;

// ---------------------------------------------------------------------------
// Storefront read facade — locale-resolved labels
// ---------------------------------------------------------------------------

export const resolvedCountrySchema = z.object({
  code: COUNTRY_CODE,
  label: z.string(),
  alpha3Code: ALPHA3_CODE,
  numericCode: NUMERIC_CODE,
  region: regionSchema,
  subregion: z.string().nullable(),
  dialCode: z.string().nullable(),
  isEuMember: z.boolean(),
  defaultCurrencyCode: CURRENCY_CODE.nullable(),
  sortOrder: z.number().int(),
});
export type ResolvedCountry = z.infer<typeof resolvedCountrySchema>;

export const resolvedCurrencySchema = z.object({
  code: CURRENCY_CODE,
  label: z.string(),
  symbol: z.string(),
  symbolPosition: symbolPositionSchema,
  decimalPlaces: z.number().int().min(0).max(6),
  sortOrder: z.number().int(),
});
export type ResolvedCurrency = z.infer<typeof resolvedCurrencySchema>;

export const resolvedLanguageSchema = z.object({
  code: LANGUAGE_CODE,
  label: z.string(),
  nativeLabel: z.string(),
  isRtl: z.boolean(),
  fallbackCode: LANGUAGE_CODE.nullable(),
  countries: z.array(COUNTRY_CODE),
  sortOrder: z.number().int(),
});
export type ResolvedLanguage = z.infer<typeof resolvedLanguageSchema>;

export const dictionaryRegistryResponseSchema = z.object({
  data: z.object({
    countries: z.array(resolvedCountrySchema),
    currencies: z.array(resolvedCurrencySchema),
    languages: z.array(resolvedLanguageSchema),
    defaults: z.object({
      country: COUNTRY_CODE.nullable(),
      currency: CURRENCY_CODE.nullable(),
      language: LANGUAGE_CODE.nullable(),
    }),
  }),
});
export type DictionaryRegistryResponse = z.infer<typeof dictionaryRegistryResponseSchema>;

const resolvedCountryWithFlagsSchema = resolvedCountrySchema.extend({ isActive: z.boolean() });
const resolvedCurrencyWithFlagsSchema = resolvedCurrencySchema.extend({ isActive: z.boolean() });
const resolvedLanguageWithFlagsSchema = resolvedLanguageSchema.extend({ isActive: z.boolean() });

export const dictionaryByCodeResponseSchema = z.object({
  data: z.discriminatedUnion('entryType', [
    z.object({ entryType: z.literal('country'), entry: resolvedCountryWithFlagsSchema }),
    z.object({ entryType: z.literal('currency'), entry: resolvedCurrencyWithFlagsSchema }),
    z.object({ entryType: z.literal('language'), entry: resolvedLanguageWithFlagsSchema }),
  ]),
});
export type DictionaryByCodeResponse = z.infer<typeof dictionaryByCodeResponseSchema>;

// ---------------------------------------------------------------------------
// Cross-module validator port (in-process, typed handle — not HTTP)
// ---------------------------------------------------------------------------

/**
 * Write-mode dispatch for the DictionaryValidator port.
 *
 * - `create-or-change`: a new write OR an update that changes the field.
 *   Both existence and active-status are required.
 * - `unchanged`: an update that does NOT change the field. Existence is
 *   required, active-status is NOT enforced — covers FR-016 (stored
 *   references that go inactive must remain readable).
 */
export type DictionaryWriteMode = 'create-or-change' | 'unchanged';

/**
 * Container name: `dictionaryValidator`. Owner: `dictionaries`.
 *
 * Consumed by every module that accepts a country/currency/language reference
 * on a write path — nine of them today, which is why the shape is declared
 * here rather than in each of them: a consumer names this type and the
 * container, never a file under `dictionaries` (Principle I).
 *
 * The wording used to say "wired via the composition root — consumer modules
 * accept this port via plugin options". That stopped being true when the
 * modules were composed by the kernel container (feature 072): the owner
 * registers the name with `ctx.di.providePort` and each consumer resolves it
 * with `lazyPort`.
 *
 * **Owner off:** the seam fails closed — resolving the port throws
 * `ModuleDisabledError` and the call answers 503 `MODULE_DISABLED`, so a write
 * that cannot have its country code checked is refused rather than accepted
 * unchecked. Whether `dictionaries` has an off state at all is its manifest's
 * `activation` to say, not this line's.
 */
export interface DictionaryValidator {
  validateCountryCode(code: string, mode: DictionaryWriteMode): Promise<void>;
  validateCurrencyCode(code: string, mode: DictionaryWriteMode): Promise<void>;
  validateLanguageCode(code: string, mode: DictionaryWriteMode): Promise<void>;
  /** Clear the in-process LRU. Called by every Dictionary write path. */
  invalidate(): void;
}

/**
 * Typed error thrown by the validator. Consumer modules' HTTP error handlers
 * translate this into a 409 envelope per contracts/dictionary-validation.contract.md.
 */
export class DictionaryReferenceError extends Error {
  readonly code: 'DICTIONARY_ENTRY_NOT_FOUND' | 'DICTIONARY_ENTRY_INACTIVE';
  readonly entryType: DictionaryEntryType;
  readonly entryCode: string;

  constructor(args: {
    code: 'DICTIONARY_ENTRY_NOT_FOUND' | 'DICTIONARY_ENTRY_INACTIVE';
    entryType: DictionaryEntryType;
    entryCode: string;
    message?: string;
  }) {
    super(
      args.message ??
        `Dictionary ${args.entryType} ${args.entryCode} ${
          args.code === 'DICTIONARY_ENTRY_NOT_FOUND' ? 'is not registered.' : 'is inactive.'
        }`,
    );
    this.name = 'DictionaryReferenceError';
    this.code = args.code;
    this.entryType = args.entryType;
    this.entryCode = args.entryCode;
  }
}

/**
 * Decide which write mode a dictionary-referencing field is being validated
 * under: `create-or-change` when the field is new or its value moved,
 * `unchanged` when it did not.
 *
 * Relocated here from `dictionaries/services/dispatch-validator-mode.ts`
 * (feature 075, Phase P) and published as a **function, not a port** — which
 * contradicts `contracts/port-publication.md` §1.5, and the code is why. That
 * section cites this file as the worked example of "yes, it reads state the
 * module owns, so make it a port"; it reads nothing. It is three comparisons
 * over its two arguments, and switching `dictionaries` off cannot change the
 * answer, so a gated port would answer 503 to a question about two strings the
 * caller already holds (FR-013).
 *
 * Five modules call it — `addresses`, `inventory`, `promotions`,
 * `sales_channels` and `taxes` — immediately before calling the validator
 * port, which *is* gated and *does* read state. Splitting the pure decision
 * from the stateful validation is what lets the second fail closed without the
 * first inventing a mode.
 */
export function dispatchValidatorMode(
  currentValue: string | null | undefined,
  incomingValue: string | null | undefined,
): DictionaryWriteMode {
  if (!currentValue) return 'create-or-change';
  if (!incomingValue) return 'unchanged';
  return currentValue === incomingValue ? 'unchanged' : 'create-or-change';
}
