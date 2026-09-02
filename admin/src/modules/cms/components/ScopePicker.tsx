/**
 * Re-export shim — this file's implementation now lives in
 * `@endora-commerce/admin-kit/components` (feature 091, P8).
 *
 * The picker sat under `cms`' admin directory and was rendered by `blog`'s two
 * editors as well as by `cms`' own three. It carried `cms`' one outgoing reach
 * with it — `sales_channels`' admin API client — and pays it inside the kit on
 * P2's terms: the component builds its two requests from the published
 * `apiClient` and the contract's own types. Its four i18n keys had no other
 * reader and moved to `core` as `scopePicker.*`.
 *
 * `CmsScopeValue` is published as `ScopePickerValue`: a kit type carrying an
 * owner's name outlives the ownership.
 *
 * **The forwarding is the identity, not a copy.** These names are the package's
 * own bindings; `admin/test/kit/admin-kit-identity.test.ts` asserts reference
 * equality across the seam.
 */
export { ScopePicker } from '@endora-commerce/admin-kit/components';
export type { ScopePickerProps, ScopePickerValue } from '@endora-commerce/admin-kit/components';
