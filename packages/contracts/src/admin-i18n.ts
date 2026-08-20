// Admin UI language versions (feature 019).
//
// Source-of-truth schemas for the Admin UI's i18n boundary. Distinct from
// `i18n.ts` (feature 017) which owns the storefront/customer-facing language
// pool — see specs/019-admin-i18n/research.md §R1 for the separation.
//
// At GA the supported set is `en` and `pl`; English is the platform-wide
// fallback (specs/019-admin-i18n/spec.md FR-013, FR-016).
//
// The set and the fallback themselves now live in `platform-language.ts`
// (feature 083, D-136): a buyer is answered out of the same enum, so naming it
// after the Admin UI was the thing that let `ADMIN_LANGUAGE_FALLBACK` sit on a
// buyer's code path for a year without anybody reading it as wrong (#234).

import { z } from 'zod';
import { SupportedLanguageSchema, type SupportedLanguage } from './platform-language.js';

/**
 * @deprecated Use `SupportedLanguageSchema` from `platform-language.ts`. The set
 * is the platform's, not the Admin UI's — a buyer is answered out of the same
 * enum (feature 083, D-136). Draining task: `specs/083-buyer-language-resolution`
 * T021.
 */
export const SupportedAdminLanguageSchema = SupportedLanguageSchema;
/**
 * @deprecated Use `SupportedLanguage` from `platform-language.ts`. Draining
 * task: `specs/083-buyer-language-resolution` T021.
 */
export type SupportedAdminLanguage = SupportedLanguage;

/**
 * On-disk bundle JSON shape and the row payload persisted to
 * `translation_bundles.entries`. Flat string→string only at v1; nested
 * objects, arrays, and non-string values are rejected.
 */
export const TranslationBundleEntriesSchema = z.record(
  z.string().min(1),
  z.string(),
);
export type TranslationBundleEntries = z.infer<typeof TranslationBundleEntriesSchema>;

/** Admin SPA boot fetch — `GET /api/v1/admin/i18n/bundles?language=…` response. */
export const GetBundlesResponseSchema = z.object({
  language: SupportedAdminLanguageSchema,
  // Monotonically-non-decreasing version vector. SPA refetches when its cached value is older.
  version: z.number().int().nonnegative(),
  // module_id → flat key/string map. The synthetic `core` namespace owns admin-chrome strings.
  bundles: z.record(z.string(), TranslationBundleEntriesSchema),
});
export type GetBundlesResponse = z.infer<typeof GetBundlesResponseSchema>;

/** `PATCH /api/v1/admin/me/preferred-language` body. `null` reverts to the platform default. */
export const PatchPreferredLanguageBodySchema = z.object({
  preferredLanguage: SupportedAdminLanguageSchema.nullable(),
});
export type PatchPreferredLanguageBody = z.infer<typeof PatchPreferredLanguageBodySchema>;

/** Standard 400 envelope when an unsupported language is requested. */
export const UnsupportedLanguageErrorSchema = z.object({
  error: z.literal('unsupported-language'),
  supported: z.array(SupportedAdminLanguageSchema),
});
export type UnsupportedLanguageError = z.infer<typeof UnsupportedLanguageErrorSchema>;

// ---------------------------------------------------------------------------
// Coverage diagnostic — feature 021
// ---------------------------------------------------------------------------

export const I18nCoverageLanguageSchema = z.object({
  languageCode: SupportedAdminLanguageSchema,
  totalKeysSeen: z.number().int().nonnegative(),
  missingCount: z.number().int().nonnegative(),
  missingKeys: z.array(z.string()),
  fellBackToEnCount: z.number().int().nonnegative(),
  fellBackToEnKeys: z.array(z.string()),
});
export type I18nCoverageLanguage = z.infer<typeof I18nCoverageLanguageSchema>;

export const I18nCoverageModuleSchema = z.object({
  moduleId: z.string(),
  languages: z.array(I18nCoverageLanguageSchema),
});
export type I18nCoverageModule = z.infer<typeof I18nCoverageModuleSchema>;

export const I18nCoverageResponseSchema = z.object({
  capturedAt: z.iso.datetime(),
  modules: z.array(I18nCoverageModuleSchema),
});
export type I18nCoverageResponse = z.infer<typeof I18nCoverageResponseSchema>;

export const I18nCoverageQuerySchema = z.object({
  module: z.union([z.string(), z.array(z.string())]).optional(),
  language: z
    .union([SupportedAdminLanguageSchema, z.array(SupportedAdminLanguageSchema)])
    .optional(),
  includeKeys: z.enum(['missing', 'all']).default('missing').optional(),
});
export type I18nCoverageQuery = z.infer<typeof I18nCoverageQuerySchema>;

// --- ports -------------------------------------------------------------------

/**
 * Container name: `adminI18nService`. Owner: `_i18n`.
 *
 * The backend-side string resolver: a module id, a key inside that module's
 * bundle and the operator's language in, the rendered sentence out. The
 * resolver falls back to English and, failing that, returns `moduleId.key`
 * verbatim — a caller that wants to detect a missing key compares against that
 * placeholder rather than against `null`.
 *
 * This is the one method the resolver's cross-module callers use. The bundle
 * install, removal and coverage surfaces of `_i18n`'s service stay inside
 * `_i18n`: they are the reconciler's business, not a consumer's.
 *
 * When `_i18n` is off the port fails closed. That is the right answer for a
 * caller rendering an operator-facing string: a screen labelled with raw keys
 * is worse than a screen that says the platform will not answer.
 *
 * Whether `_i18n` has an off state at all is its manifest's `activation` to
 * say, not this line's: a module declaring `nonDeactivatable` never enters one.
 */
export interface AdminI18nTranslatePort {
  translate(
    moduleId: string,
    key: string,
    language: SupportedAdminLanguage,
    params?: Record<string, string | number>,
  ): Promise<string>;
}
