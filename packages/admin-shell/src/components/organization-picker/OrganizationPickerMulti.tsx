/**
 * Re-export shim — this file's implementation now lives in
 * `@endora-commerce/admin-kit/components` (feature 091, P2).
 *
 * The picker stayed in `admin/src` through Phase 1b because it fetched from
 * another module's admin API client, which publishing would have put in the kit
 * (`admin-kit-surface.md` R6). P2 takes the client exit instead — the component
 * builds its own request from the published `apiClient` and the owner's
 * contract types — so it holds no module knowledge and is published like the
 * rest of the design system.
 *
 * **The forwarding is the identity, not a copy.** These names are the package's
 * own bindings; `admin/test/kit/admin-kit-identity.test.ts` asserts reference
 * equality across the seam, because a second React context or a second class
 * passes every structural comparison and still breaks at runtime.
 */
export { OrganizationPickerMulti } from '@endora-commerce/admin-kit/components';
export type { OrganizationPickerMultiProps } from '@endora-commerce/admin-kit/components';
