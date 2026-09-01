/**
 * Re-export shim — this file's implementation now lives in
 * `@endora-commerce/admin-kit/components` (feature 091, batch 8).
 *
 * `ProductPicker` sat under `catalog`'s admin directory and was rendered by
 * `seo`, `orders` and `quote_requests` as well as by `catalog` itself — four
 * keys in `backend/scripts/ledgers/cross-module-imports/`. Nothing about it was
 * `catalog`'s code: it builds its two requests from the published `apiClient`
 * and a hard-coded admin path, which is the exit `admin-kit-surface.md` R6
 * permits and which P2's three pickers took.
 *
 * The four consumers name the package subpath directly. The shim stays because
 * the old path is the spelling this module's own tests and any client tree
 * already hold, and because a second resolution would be a second copy of the
 * component.
 *
 * **The forwarding is the identity, not a copy.** These names are the package's
 * own bindings; `admin/test/kit/admin-kit-identity.test.ts` asserts reference
 * equality across the seam, because a second React context or a second class
 * passes every structural comparison and still breaks at runtime.
 */
export { ProductPicker } from '@endora-commerce/admin-kit/components';
export type { ProductPickerProps } from '@endora-commerce/admin-kit/components';
