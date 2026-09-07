/**
 * Re-export shim — this file's implementation now lives in
 * `@endora-commerce/admin-kit/i18n` (feature 091, Phase 1b).
 *
 * The design system moved into the package so that a module package's `./admin` layer
 * can reach it by a bare specifier through an `exports` map (FR-008): `@/` is a Vite and
 * `tsc` alias that an installed package cannot resolve. Every existing `@/…` specifier in
 * this application arrives here and is forwarded, so nothing outside had to be rewritten
 * — the shape feature 080 used for the platform relocation.
 *
 * **The forwarding is the identity, not a copy.** These names are the package's own
 * bindings; `admin/test/kit/admin-kit-shims.test.ts` asserts reference equality across
 * the seam, because a second React context or a second `z.enum` passes every structural
 * comparison and still breaks at runtime.
 */
export type { Bundle, GetBundlesResponse, ResolveOutcome, ScopedBundle, SupportedAdminLanguage, TranslationBundleEntries } from '@endora-commerce/admin-kit/i18n';
