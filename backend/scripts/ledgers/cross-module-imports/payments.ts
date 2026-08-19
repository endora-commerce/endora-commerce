/**
 * Cross-module imports still standing in `payments` (feature 075, FR-022…FR-026).
 *
 * Keyed `<path under src/>:<target module>/<target path>`, so moving code inside
 * a file does not invalidate an entry and re-opening a hole does not silently
 * inherit one — the same key discipline as `BARE_SUBSCRIPTIONS_TO_DRAIN`.
 *
 * Two-way: an unledgered import fails the build, and an entry that no longer
 * describes one fails it too. Delete this file when the last entry goes; an
 * empty shard is refused, because a done signal that says nothing is not one.
 *
 * Eleven of this module's fourteen entries were retired by the Phase C cut. The
 * three left are all in `receive-payment-handler.ts`, and none of them carries
 * the sweep's default reason: one is **permanent** under D-78 point 2, and two
 * wait on a named merge request rather than on a date.
 *
 * The permanent one said so in prose only until issue #217. A bare string is
 * read as a draining reason whatever it spells, so the entry counted toward
 * `ledger-size` — debt the sweep is measured against, over a seam a foreign key
 * holds — and `permanentEntryIssue` never ran on it, which is the check that
 * refuses a permanence claim naming no retiring condition. It is now the same
 * `{ permanent: true, reason, retiredBy }` shape `catalog`, `orders` and
 * `shipments` carry, so the classification is structural rather than a word in
 * a sentence.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'modules/payments/services/receive-payment-handler.ts:orders/entities/order.entity': {
    permanent: true,
    reason:
      'PERMANENT (D-78 point 2). `payments.order_id` carries a declared foreign key into ' +
      '`orders.id` — `payments_order_fk`, `on delete restrict` — and a gateway callback moves ' +
      'the payment row and the order’s `status` / `paymentStatus` inside one `em.transactional`, ' +
      'so either both land or neither does. `emFactory` forks per call, so a read port executes ' +
      'on the owner’s EntityManager, in a different transaction; routing this write through one ' +
      'would trade the atomicity for a boundary without saying so. D-78 rules such a seam kept, ' +
      'on the caller’s EntityManager, and **declared**: `orders` is in this module’s manifest ' +
      '`dependencies`, this entry names the constraint, and the import site carries a comment ' +
      'saying which transaction the write runs in. `shipments` carries the identical seam in ' +
      '`receive-shipment-handler.ts`, settled the same way by D-90.',
    retiredBy:
      'F4 gives `orders` a package entry point, at which point this is a package dependency the ' +
      'manifest already declares rather than an import of internals. Dropping ' +
      '`payments_order_fk` would retire it too, and would cost the invariant the constraint ' +
      'buys — a payment row pointing at no order.',
  },
  'modules/payments/services/receive-payment-handler.ts:payment_methods/entities/payment-method.entity':
    'F3 Phase C — a pure read with a port ready for it (`paymentMethodReadPort`), blocked on ' +
    'the constructor rather than on the read. `stripe`, `payu`, `tpay` and `autopay` each ' +
    'construct this handler themselves, and none of them can build a `payment_methods` port ' +
    'without importing that module. Retired by the four gateway cuts (C-W3), which resolve ' +
    'the `receivePaymentPort` Phase P published for exactly that instead of calling ' +
    '`new ReceivePaymentHandler(…)`; the constructor may then take the port.',
  'modules/payments/services/receive-payment-handler.ts:orders/events/order-status-events':
    'F3 Phase C — the templated status announcement, blocked the same way and by the same ' +
    'four constructions. `orderStatusAnnouncePort` is published and this module already ' +
    'declares `orders`; what is missing is a constructor the gateways can call. Retired by ' +
    'the four gateway cuts (C-W3), together with the entry above it.',
};
