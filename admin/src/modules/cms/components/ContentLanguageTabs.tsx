/**
 * Re-export shim — this file's implementation now lives in
 * `@endora-commerce/admin-kit/components` (feature 091, P8).
 *
 * The strip sat under `cms`' admin directory and was rendered by `blog`'s two
 * editors as well as by `cms`' own three — two `cross-module-imports` keys over
 * a tab list that holds nothing of `cms`. Its two i18n keys had no other reader
 * and moved to `core` as `contentLanguageTabs.*`, because a translation
 * namespace is module knowledge (R-1, `admin-kit-surface.md` R6).
 *
 * The five consumers name the package subpath directly. The shim stays because
 * the old path is the spelling this module's own tests and any client tree
 * already hold, and because a second resolution would be a second copy of the
 * component.
 *
 * **The forwarding is the identity, not a copy.** These names are the package's
 * own bindings; `admin/test/kit/admin-kit-identity.test.ts` asserts reference
 * equality across the seam, because a second React context or a second class
 * passes every structural comparison and still breaks at runtime.
 */
export { ContentLanguageTabs } from '@endora-commerce/admin-kit/components';
export type { ContentLanguageTabsProps } from '@endora-commerce/admin-kit/components';
