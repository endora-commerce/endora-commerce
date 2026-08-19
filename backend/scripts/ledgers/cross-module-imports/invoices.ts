/**
 * Cross-module imports still standing in `invoices` (feature 075, FR-022…FR-026).
 *
 * Keyed `<path under src/>:<target module>/<target path>`, so moving code inside
 * a file does not invalidate an entry and re-opening a hole does not silently
 * inherit one — the same key discipline as `BARE_SUBSCRIPTIONS_TO_DRAIN`.
 *
 * Two-way: an unledgered import fails the build, and an entry that no longer
 * describes one fails it too. Delete this file when the last entry goes; an
 * empty shard is refused, because a done signal that says nothing is not one.
 *
 * "Retired by the cut merge request" is a reason only while the sweep runs.
 * After 2026-12-31 it stops being an acceptable one: an entry still carrying it
 * is a boundary the repository has decided to keep, and it needs a reason that
 * says so.
 *
 * The cut merge request took seven of the nine: five reads of `orders`' rows to
 * `orderReadPort`, and two type-only imports to the contracts their owners
 * publish. Neither entry below is a read this module could have moved.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'modules/invoices/entities/invoice.entity.ts:orders/entities/order.entity':
    'F3 Phase C — invoices. Not retired by the invoices cut merge request: this is the ' +
    '`@TransitivelyScoped(() => Order, "orderId")` argument, a tenancy classification ' +
    'rather than a read, evaluated at class-definition time when no container exists — ' +
    'so no port can carry it (R-05). This is the second of the two sites FR-017 names; ' +
    '`ksef/entities/ksef-submission.entity.ts` is the first and carries the same reason. ' +
    'Retired by the question R-05 asks: does `TransitivelyScoped` take a registered ' +
    'parent token, resolved at boot from the kernel tenancy registry, with ' +
    '`check-entity-tenant-classification.ts` failing on one that resolves to nothing? ' +
    'That is a kernel change, and with both sites now ledgered it is the only work left ' +
    'on FR-017.',
  'modules/invoices/routes.admin.ts:orders/entities/order.entity':
    'F3 Phase C — invoices. Half of this file was retired by the cut merge request — the ' +
    'order-number and owning-organisation lookup for a page of invoices is ' +
    '`orderReadPort.findByIds` now. This half is the `filter[orderNumber]` search: ' +
    '`em.find(Order, { businessId: { $ilike: `%…%` } }, { fields: ["id"], limit: 500 })`, ' +
    'which narrows the invoice query *before* its own limit is applied. `OrderReadPort` ' +
    'publishes findById/findByIds/listAll/listItems and no search, and neither ' +
    '`orderListPort.list({ q })` nor an in-memory filter after the limit preserves the ' +
    "admin list's result set. Retired by `orders` publishing the search it owns — one " +
    'method, `findIdsByBusinessIdLike(fragment, limit)` — which is that module\'s Phase-P ' +
    'work and not a consumer\'s to guess at (contracts/port-publication.md §1.1).',
};
