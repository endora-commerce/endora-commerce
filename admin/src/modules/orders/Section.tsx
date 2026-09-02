/**
 * Re-export shim — this file's implementation now lives in
 * `@endora-commerce/admin-kit/ui` (feature 091, P8).
 *
 * `Section` sat under `orders`' admin directory and was rendered by
 * `quote_requests`' RFQ detail as well as by three of `orders`' own tabs —
 * fourteen lines of `<section>`, `cn` and a heading, with no module knowledge
 * at all. Being a layout primitive rather than a composite, its home in the kit
 * is `./ui` and not `./components`.
 *
 * **The forwarding is the identity, not a copy.** These names are the package's
 * own bindings; `admin/test/kit/admin-kit-identity.test.ts` asserts reference
 * equality across the seam.
 */
export { Section } from '@endora-commerce/admin-kit/ui';
export type { SectionProps } from '@endora-commerce/admin-kit/ui';
