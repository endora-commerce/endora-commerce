/**
 * Re-export shim — this file's implementation now lives in
 * `@endora-commerce/admin-kit/components` (feature 091, P4e).
 *
 * `admin-component-contribution.md` §9.1 rules that `CustomFieldValuesPanel` is
 * a published component and never was a zone contribution: its props are
 * `(entityType, values, save)`, so every call site hands it the **host's own**
 * stored bag and the host's own writer, and `custom_fields`' admin API serves
 * definitions and no values at all. Nothing that crosses this seam is the
 * owner's code, so the exit is P2's — the component rebuilds its one `GET` from
 * the published `apiClient` and the owner's contract types.
 *
 * The four consumers (`customers`, `orders`, `organizations`,
 * `quote_requests`) name the package subpath directly. The shim stays because
 * the old path is the spelling this module's own tests and any client tree
 * already hold, and because a second resolution of the component would be a
 * second copy of it.
 *
 * **The forwarding is the identity, not a copy.** These names are the package's
 * own bindings; `admin/test/kit/admin-kit-identity.test.ts` asserts
 * reference equality across the seam, because a second React context or a
 * second class passes every structural comparison and still breaks at runtime.
 */
export { CustomFieldValuesPanel } from '@endora-commerce/admin-kit/components';
export type { CustomFieldValuesPanelProps } from '@endora-commerce/admin-kit/components';
