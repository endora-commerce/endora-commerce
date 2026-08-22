// Admin UI i18n runtime types — feature 019.
//
// Re-exports of the contract shapes plus admin-side type aliases. The
// Bundle and ScopedBundle aliases are used by TranslationProvider and
// the resolver respectively — see admin/src/i18n/resolver.ts.

import type {
  GetBundlesResponse,
  SupportedAdminLanguage,
  TranslationBundleEntries,
} from '@endora-commerce/contracts';

export type {
  GetBundlesResponse,
  SupportedAdminLanguage,
  TranslationBundleEntries,
};

/** Per-module scoped bundle (one language). */
export type ScopedBundle = TranslationBundleEntries;

/**
 * Merged bundle delivered to the SPA — `moduleId → entries` for the
 * single language the user is currently viewing.
 */
export type Bundle = GetBundlesResponse['bundles'];

/** Outcome of a single resolver lookup; lets callers observe the fallback chain. */
export type ResolveOutcome = 'requested' | 'en' | 'placeholder';
