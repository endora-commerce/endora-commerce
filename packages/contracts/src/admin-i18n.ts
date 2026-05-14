// Admin UI language versions (feature 019).
//
// Source-of-truth schemas for the Admin UI's i18n boundary. Distinct from
// `i18n.ts` (feature 017) which owns the storefront/customer-facing language
// pool — see specs/019-admin-i18n/research.md §R1 for the separation.
//
// At GA the supported set is `en` and `pl`; English is the platform-wide
// fallback (specs/019-admin-i18n/spec.md FR-013, FR-016).

import { z } from 'zod';

/** Supported Admin UI languages — closed enum at GA, extensible by code change. */
export const SupportedAdminLanguageSchema = z.enum(['en', 'pl']);
export type SupportedAdminLanguage = z.infer<typeof SupportedAdminLanguageSchema>;

/** Convenience: every supported value as a runtime array. */
export const SUPPORTED_ADMIN_LANGUAGES = SupportedAdminLanguageSchema.options;

/** Platform-wide fallback used by the resolver when the user's preferred bundle has no entry. */
export const ADMIN_LANGUAGE_FALLBACK: SupportedAdminLanguage = 'en';

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
