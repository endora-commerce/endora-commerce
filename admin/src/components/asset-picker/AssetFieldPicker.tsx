/**
 * Re-export shim — this file's implementation now lives in
 * `@endora-commerce/admin-kit/components` (feature 091, P4c).
 *
 * The field picker stayed in `admin/src` through Phase 1b and through P2 on the
 * reading that its module knowledge was a **component** — `assets_library`' own
 * `AssetPicker` — so there was no request to rebuild and it had to wait for a
 * zone. `admin-component-contribution.md` Z1.1 measured one level deeper:
 * `AssetPicker` is 153 lines over one `GET`, `AssetUploader` posts multipart to
 * the origin the kit already publishes, and every type all three name is
 * `@endora-commerce/contracts`'. The whole cluster is P2's shape, and it took
 * P2's exit.
 *
 * **The forwarding is the identity, not a copy.** These names are the package's
 * own bindings; `admin/test/kit/admin-kit-identity.test.ts` asserts reference
 * equality across the seam, because a second React context or a second class
 * passes every structural comparison and still breaks at runtime.
 */
export { AssetFieldPicker } from '@endora-commerce/admin-kit/components';
export type { AssetFieldPickerProps } from '@endora-commerce/admin-kit/components';
