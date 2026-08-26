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
 * Thirteen of this module's fourteen entries are retired. Eleven went with the
 * Phase C cut; the other two went with C-W3, which removed the blocker they
 * rested on rather than the seam — `stripe`, `payu`, `tpay` and `autopay` all
 * resolve `receivePaymentPort` now, so the only `new ReceivePaymentHandler(…)`
 * left is in `payments/backend.ts`, where `ctx` is in hand and the constructor
 * takes `paymentMethodReadPort` and `orderTransitionPort`. Neither of the
 * two is held by the constraint the entry below rests on: the payment-method
 * read is a read of a row the settlement transaction never writes, and the
 * lifecycle transition runs after that transaction has committed.
 *
 * The one left is **permanent** under D-78 point 2. Feature 080's T048 changed
 * its **spelling** and nothing else: what crosses is `orders`' own
 * `OrderPaymentStatusApplyPort`, on that module's `ports/` directory, instead
 * of the `Order` entity class D-168 leaves a packaged `orders` no supported
 * name for. Same transaction, same constraint, same one column. The entry stays
 * and stays permanent, exactly as D-171 predicts — `resolveModulePackage`
 * returns `null` for any specifier starting with `.`, so a relative import into
 * an owner's `ports/` directory has no subpath for the exemption to apply to,
 * and packaging `orders` is what finishes it.
 *
 * Feature 085 Phase D narrowed what it covers: the co-transactional pair is now the payment row and
 * `order.paymentStatus`, the two things `payments_order_fk` holds. The order's
 * *lifecycle* status left with the port. `shipments` carried the identical
 * entry, settled by D-90 on the identical ground, and it is gone entirely —
 * that handler wrote nothing else on the order, so its shard is deleted rather
 * than emptied.
 *
 * It said so in prose only until issue #217. A bare string is
 * read as a draining reason whatever it spells, so the entry counted toward
 * `ledger-size` — debt the sweep is measured against, over a seam a foreign key
 * holds — and `permanentEntryIssue` never ran on it, which is the check that
 * refuses a permanence claim naming no retiring condition. It is now the same
 * `{ permanent: true, reason, retiredBy }` shape `catalog` and `orders` carry,
 * so the classification is structural rather than a word in a sentence.
 *
 * The typing itself is no longer a convention either. `payments` was one of 29
 * shards declaring `Readonly<Record<string, string>>` against four declaring the
 * entry type, so "the other files do it this way" was not even true here; the
 * check now reads the declaration out of each shard's own source and refuses one
 * that types its entries differently.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'modules/payments/services/receive-payment-handler.ts:orders/ports/index': {
    permanent: true,
    reason:
      'PERMANENT (D-78 point 2). `payments.order_id` carries a declared foreign key into ' +
      '`orders.id` — `payments_order_fk`, `on delete restrict`, added by ' +
      '`db/migrations/20260425T050720_core_commerce_init.ts:173`, in the frozen historical ' +
      'prefix — and a gateway callback moves ' +
      'the payment row and the order’s `paymentStatus` inside one `em.transactional`, ' +
      'so either both land or neither does. `emFactory` forks per call, so a read port executes ' +
      'on the owner’s EntityManager, in a different transaction; routing this write through one ' +
      'would trade the atomicity for a boundary without saying so. D-78 rules such a seam kept, ' +
      'on the caller’s EntityManager, and **declared**: `orders` is in this module’s manifest ' +
      '`dependencies`, this entry names the constraint, and the import site carries a comment ' +
      'saying which transaction the write runs in. ' +
      'Feature 085 Phase D narrowed this seam to the money axis, and retired the twin entry ' +
      'D-90 had settled the same way in `shipments`. Both handlers also assigned `order.status` ' +
      'on that same `tx`, and a status change is a *transition* — a graph decision with veto ' +
      'guards, a co-transactional audit entry and side-effects that release stock — not a ' +
      'column, so it moved to `orderTransitionPort` and is called after the commit. ' +
      '`receive-shipment-handler.ts` wrote nothing else on the order, so its shard is deleted; ' +
      'this file still writes `paymentStatus`, which is the column the foreign key genuinely ' +
      'holds together with the payment row. ' +
      '**Feature 080`s T048 converted what crosses, and nothing else** (D-169): it was the ' +
      '`Order` entity class, which D-168 leaves a packaged `orders` no supported spelling for, ' +
      'and it is now `OrderPaymentStatusApplyPort` — the owner`s own interface, declared in the ' +
      'owner`s `ports/` directory because its `EntityManager` parameter bars it from ' +
      '`@endora-commerce/contracts` (FR-034). The transaction, the constraint and the one ' +
      'column are exactly as they were; a foreign key needs the **table** and never the class. ' +
      'What the conversion removed is this module`s ability to move any other column of ' +
      '`orders`` aggregate on a transaction it happens to hold: the port answers a published ' +
      'record and hands back no managed row.',
    retiredBy:
      'F4 packages `orders`, at which point that same directory is the package`s `./ports` ' +
      'subpath, D-171 stops counting the reach, and the consumer-side edit is this one ' +
      'specifier. It is not retired by the relocation alone: `resolveModulePackage` returns ' +
      '`null` for anything starting with `.`, so a relative specifier has no subpath for the ' +
      'exemption to apply to, and the three edits (package the owner, publish the interface, ' +
      'rewrite the specifier) are separable by design — this entry stands with the second ' +
      'done. Dropping `payments_order_fk` would retire it too, and would cost the invariant ' +
      'the constraint buys — a payment row pointing at no order.',
  },
};
