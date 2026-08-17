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
 * one left is not "not yet done" — it is the boundary question the cut ran
 * into, stated below with the answer that retires it, which is what FR-025 asks
 * of an entry that outlives the sweep's default reason.
 */
export const entries: Readonly<Record<string, string>> = {
  'modules/shipments/services/receive-shipment-handler.ts:orders/entities/order.entity':
    'F3 Phase C — the one edge in `shipments` that is transactional rather than typed. ' +
    'The carrier `receive_shipment` callback moves the shipment row and the order status ' +
    'inside one `em.transactional`, so a callback either records both or neither. ' +
    '`emFactory` forks per call, so a port executes on the owner’s EntityManager — a ' +
    'different transaction — and swapping this read for `orderReadPort` would trade that ' +
    'atomicity for a boundary without saying so. `payments` carries the identical edge in ' +
    '`receive-payment-handler.ts`, so one answer retires both. Retired by: does `orders` ' +
    'publish a status write that participates in the caller’s transaction, or does the ' +
    'shipment→order transition become an event `orders` consumes — accepting that the ' +
    'route stops returning the new order status synchronously?',
};
