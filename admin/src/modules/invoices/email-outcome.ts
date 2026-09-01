/**
 * Re-export shim — this file's implementation now lives in
 * `@endora-commerce/admin-kit/lib` (feature 091, P8).
 *
 * The three functions sat under `invoices`' admin directory and `orders`' order
 * detail imported one of them — the single `cross-module-imports/orders.ts`
 * key. Nothing about them is `invoices`' code: the outcome shapes are
 * `@endora-commerce/contracts`', and all twelve sentences they read were
 * already `core`'s in both shipped languages, which is what made this a
 * publication and not a key move.
 *
 * **The forwarding is the identity, not a copy.** These names are the package's
 * own bindings; `admin/test/kit/admin-kit-identity.test.ts` asserts reference
 * equality across the seam.
 */
export {
  invoiceEmailNotSentReason,
  issueInvoiceNotice,
  sendInvoiceEmailMessage,
} from '@endora-commerce/admin-kit/lib';
export type { Translate } from '@endora-commerce/admin-kit/lib';
