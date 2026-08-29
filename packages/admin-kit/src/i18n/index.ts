/**
 * `@endora-commerce/admin-kit/i18n` — Translation: the provider, the language context and `useTranslation`.
 *
 * The membership is **derived, never designed**
 * (`specs/091-module-owned-admin-surfaces/contracts/admin-kit-surface.md` §1): every
 * `from '…'` specifier in the admin's module directories that resolves inside the admin
 * source root and outside the importing file's own module directory, plus the transitive
 * closure of those files, which is what has to live in one place for there to be one copy.
 *
 * The barrel is **explicit and holds no `export *`** (R2): a short published set reports
 * more findings than a complete one, and its obvious repair is to widen the barrel
 * silently. `check:admin-surface` refuses one and exits 2.
 *
 * Every binding here is the **only** copy in the process. `admin/src` keeps a re-export
 * shim at each old path, so a `@/…` specifier and this subpath name one module record —
 * proved by reference equality in `admin/test/kit/admin-kit-shims.test.ts`, not by a
 * structural comparison, which a second React context would pass.
 */
export { TranslationProvider, useTranslationContext } from './TranslationProvider.js';
export type { TranslationProviderProps } from './TranslationProvider.js';
export { AppLanguageContext, useAppLanguage } from './app-language-context.js';
export type { AppLanguageContextValue } from './app-language-context.js';
export { interpolate } from './interpolate.js';
export { getBundles, reloadBundles, setPreferredLanguage } from './language-storage.js';
export { resolve } from './resolver.js';
export type { ResolveArgs, ResolveResult } from './resolver.js';
export type { Bundle, GetBundlesResponse, ResolveOutcome, ScopedBundle, SupportedAdminLanguage, TranslationBundleEntries } from './types.js';
export { useTranslation } from './useTranslation.js';
