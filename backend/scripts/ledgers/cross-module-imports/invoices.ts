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
 * publish. Neither of the two it left was a read this module could have moved.
 *
 * One of those two is gone as of feature 080's T049 (D-169): the
 * `@TransitivelyScoped` argument in `entities/invoice.entity.ts` named the
 * `Order` class, and now names the string `'Order'`, resolved lazily against the
 * classification registry and reconciled at boot. That was R-05's question, and
 * the answer retired the entry rather than re-worded it — which is what makes
 * `invoices` packageable. `ksef` had one entry of exactly the same shape; its
 * shard is deleted.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
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
