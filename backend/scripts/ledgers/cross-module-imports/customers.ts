/**
 * Cross-module imports still standing in `customers` (feature 075, FR-022…FR-026).
 *
 * Keyed `<path under src/>:<target module>/<target path>`, so moving code inside
 * a file does not invalidate an entry and re-opening a hole does not silently
 * inherit one — the same key discipline as `BARE_SUBSCRIPTIONS_TO_DRAIN`.
 *
 * Two-way: an unledgered import fails the build, and an entry that no longer
 * describes one fails it too. Delete this file when the last entry goes; an
 * empty shard is refused, because a done signal that says nothing is not one.
 *
 * **Seventeen of this module's eighteen sites were cut by the `customers`
 * Phase-C merge request**, and every one of them by resolving a port that was
 * already published and had never been reached: `impersonationPort`,
 * `cartQueryPort`, `orderListPort`, `rfqService`, `customFieldValueService`,
 * `emailMailer` and `authSessionReadPort`. Four of those contracts name this
 * module by id as the consumer they were written for. Two more sites were not
 * a port question at all — `SESSION_COOKIE_NAME` and `ADMIN_SESSION_COOKIE_NAME`
 * live in `@endora-commerce/contracts`, and `auth/plugin.ts` only re-exports them, so this
 * module was the last one in the tree taking them the long way round.
 *
 * The cut had been withdrawn once on a lock claim over this module — a claim
 * the manifest contradicts, and has contradicted since it was written: the
 * activation control is `customers.enabled` (issue #216). `check:lock-claims`
 * refuses that sentence now, in any artefact, wherever a reason rests on it.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'modules/customers/services/customer-admin-query-service.ts:orders/entities/order.entity':
    'F3 Phase C — customers, left because no published shape answers it. The customer-detail ' +
    'screen shows which sales channels a buyer has ordered on, which is one `select distinct ' +
    'sales_channel_id` over that buyer\'s orders. `OrderListPort.list` cannot answer it: it ' +
    'is paginated, so the set of channels it yields is the set on one page, and a detail ' +
    'header that silently narrowed with the page size would be a different fact under the ' +
    'same label. `OrderReadPort` has no per-customer read. Retired by: a ' +
    '`salesChannelIdsForCustomer(customerAccountId)` read on `orders`\' published surface — ' +
    'that module\'s to add, and the only site in this module still naming an `orders` entity.',
};
