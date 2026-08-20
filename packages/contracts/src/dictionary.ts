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

// ---------------------------------------------------------------------------
// Reference registries — "who still points at this dictionary entry?"
// (feature 077, D-87 drain).
// ---------------------------------------------------------------------------

/**
 * One consumer's answer about one dictionary code.
 *
 * The four descriptive fields are what the operator sees in the orphan report,
 * and `ownerModuleId` is what attributes a refused delete to a module.
 */
export interface DictionaryReference {
  ownerModuleId: string;
  /** Operator-facing name of the consuming surface, e.g. `blog`. */
  consumer: string;
  /** The consumer's own table holding the reference. */
  tableName: string;
  /** The column, or the JSON path inside it, e.g. `registered_address.country`. */
  columnName: string;
  code: string;
  count: number;
  /**
   * Whether this reference refuses the delete.
   *
   * `false` where the consumer's own foreign key clears the value instead
   * (`on delete set null`) — the reference is still reported, because an
   * operator about to blank a column wants to know, but it does not block.
   * The decision belongs to the module that owns the referencing table, which
   * is why it travels on the descriptor rather than in a caller's exception
   * list.
   */
  blocking: boolean;
}

/**
 * One contributed "who points at this dictionary entry" scanner.
 *
 * A module that stores a country, language or currency code registers one of
 * these per column it stores it in, from its own `ctx.onBoot`. It queries its
 * **own** tables and nothing else — which is the whole point: before this
 * existed, `dictionaries`, `languages` and `currencies` each hand-wrote SQL
 * naming twelve other modules' tables, invisible to every import-level
 * boundary check because raw SQL names no specifier (D-87).
 *
 * `ownerModuleId` is required and is the whole mechanism (D-39): without it the
 * registry could not state a policy for an absent owner at all.
 */
export interface DictionaryReferenceDescriptor {
  ownerModuleId: string;
  consumer: string;
  tableName: string;
  columnName: string;
  /** See {@link DictionaryReference.blocking}. */
  blocking: boolean;
  /**
   * How many of this consumer's rows reference `code`. Asked before a delete,
   * so it must be a point query the consumer's own indexes can serve.
   */
  countReferences(code: string): Promise<number>;
  /**
   * Every code this consumer stores, with its row count. Asked by the orphan
   * report, which is a full-table audit by nature — the caller subtracts the
   * dictionary's own codes to find the danglers.
   */
  usedCodes(): Promise<ReadonlyArray<{ code: string; count: number }>>;
}

/**
 * Container name: `countryReferenceRegistry`. Owner: `dictionaries`.
 * Container name: `languageReferenceRegistry`. Owner: `languages`.
 * Container name: `currencyReferenceRegistry`. Owner: `currencies`.
 *
 * One shape, three instances — one per dictionary, each owned by the module
 * that owns the table being pointed at. Three rather than one because the
 * enumeration policy and the 409 belong to the owner of the entry being
 * deleted, and because a single registry would have to live in a module that
 * two of the three readers cannot declare without closing a manifest cycle
 * (`dictionaries` already depends on `languages` and `currencies`).
 *
 * A **contribution seam**: contributors push from a boot hook and read nothing
 * back, so the registration is a plain `ctx.di.register` rather than a
 * `providePort` — a boot hook that resolved a gate would stop the backend from
 * starting whenever the registry's owner was switched off. All three owners are
 * `nonDeactivatable` today, which is why no reader here degrades.
 *
 * **Enumeration policy: honoured while the contributing module is absent.**
 * D-39's default is to skip, and honouring needs a written reason: this is
 * referential integrity, not a surface. If `blog` is switched off its posts
 * still exist and still carry language codes; skipping `blog`'s descriptor
 * would let an operator delete a language that comes back as a dangling
 * reference the moment `blog` is switched on again — data loss caused by an
 * action Constitution XVII promises is non-destructive and reversible. Nobody
 * sees a descriptor; they exist to refuse a delete and to report a dangler.
 */
export interface DictionaryReferenceRegistryPort {
  register(descriptor: DictionaryReferenceDescriptor): void;
  /** The contributing module of every registered descriptor, in registration order. */
  owners(): readonly string[];
  /** Every reference pointing at one code, across all descriptors. Zero counts dropped. */
  countReferences(code: string): Promise<DictionaryReference[]>;
  /** Every code every descriptor stores, with its row count. */
  usedCodes(): Promise<DictionaryReference[]>;
}
