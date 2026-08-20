/**
 * Cross-module imports still standing in `shipments` (feature 075, FR-022…FR-026).
 *
 * Keyed `<path under src/>:<target module>/<target path>`, so moving code inside
 * a file does not invalidate an entry and re-opening a hole does not silently
 * inherit one — the same key discipline as `BARE_SUBSCRIPTIONS_TO_DRAIN`.
 *
 * Two-way: an unledgered import fails the build, and an entry that no longer
 * describes one fails it too. Delete this file when the last entry goes; an
 * empty shard is refused, because a done signal that says nothing is not one.
 *
 * Eleven of this module's twelve entries were retired by the Phase C cut. The
 * one left is **permanent** since D-90: it is not waiting on a merge request,
 * it rests on a constraint in the schema, so it is excluded from `ledger-size`
 * and printed separately.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'modules/shipments/services/receive-shipment-handler.ts:orders/entities/order.entity': {
    permanent: true,
    reason:
      'PERMANENT (D-90, under D-78 point 2). `shipments.order_id` carries a declared foreign ' +
      'key into `orders.id` — `shipments_order_fk`, `on delete restrict`, added by ' +
      '`shipments/migrations/20260817T194652_shipments_order_fk.ts` — and the carrier ' +
      '`receive_shipment` callback moves the shipment row and the order status inside one ' +
      '`em.transactional`, so a callback records both or neither. `emFactory` forks per call, ' +
      'so a port executes on the owner’s EntityManager, in a different transaction; routing ' +
      'this write through one would trade the atomicity for a boundary without saying so. The ' +
      'two escapes are refused in writing: D-58 refused the outbox a split would need to be ' +
      'safe, and D-78 refused a port that participates in the caller’s transaction. D-90 rules ' +
      'the seam kept, on the caller’s EntityManager, and **declared**: `orders` is in this ' +
      'module’s manifest `dependencies` (it already was), this entry names the constraint, and ' +
      'the import site carries a comment saying which transaction the write runs in. `payments` ' +
      'carries the identical seam in `receive-payment-handler.ts`, settled the same way. The ' +
      'after-commit half is already a port and stays one: `orderStatusAnnouncePort` makes the ' +
      'templated status announcement.',
    retiredBy:
      'F4 gives `orders` a package entry point, at which point this is a package dependency the ' +
      'manifest already declares rather than an import of internals. Dropping ' +
      '`shipments_order_fk` would retire it too, and would cost the invariant the constraint ' +
      'buys — a shipment row pointing at no order.',
  },
};
