/**
 * Cross-module imports still standing in `orders` (feature 075, FR-022…FR-026).
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
 * **Nothing left here carries that sentence.** The `orders` cut drained 64 of
 * this module's 73 entries across five merge requests. What remains is eleven
 * entries of three kinds, and none is "not yet done":
 *
 *  - **two `permanent: true`** — the `payments` and `invoices` rows placement
 *    opens, held co-transactional by `payments_order_fk` and
 *    `invoices_order_fk` (D-78 point 2). Each names its constraint and what
 *    would retire it.
 *  - **seven escalated** — the stock reservation (five) and the cart
 *    completion (two). Both are co-transactional with placement and neither
 *    has a foreign key to justify it, so they are D-78 point 3: a boundary
 *    error raised for a design decision rather than solved inside a cut. Each
 *    entry states the analysis, including why moving the operation into the
 *    owner does not work and which test asserts the property that stops it.
 *  - **two `sql:` reaches seen only since issue #187** — the channel→warehouse
 *    knex join inside the placement transaction. Not a new coupling: a knex
 *    builder names its table as a call argument, so both predicates were blind
 *    to it while the other nine entries were being drained. D-94.4 has already
 *    ruled how they go.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'modules/orders/services/order-service.ts:carts/entities/cart-item.entity':
    'F3 Phase C — orders. **Escalated, not deferred.** Placement ends by clearing the buyer`s cart and marking it `completed`, inside the placement transaction and on the same `Cart` object the totals were read from. There is no foreign key between `carts` and `orders` in either direction, so D-78 point 2 does not apply; and D-78 point 1 does not either, because a `cartWritePort` call would commit the cart completion in its own transaction and leave a buyer with an emptied cart and no order whenever placement then fails (test/integration/orders/place-order-failure-preserves-cart.test.ts asserts the opposite). So it is D-78 point 3, and it is raised rather than solved. The reorder path`s cart write was a different question and is already cut, through `cartWritePort.replaceItemsForCustomer`.',
  'modules/orders/services/order-service.ts:carts/entities/cart.entity':
    'F3 Phase C — orders. **Escalated, not deferred.** Placement ends by clearing the buyer`s cart and marking it `completed`, inside the placement transaction and on the same `Cart` object the totals were read from. There is no foreign key between `carts` and `orders` in either direction, so D-78 point 2 does not apply; and D-78 point 1 does not either, because a `cartWritePort` call would commit the cart completion in its own transaction and leave a buyer with an emptied cart and no order whenever placement then fails (test/integration/orders/place-order-failure-preserves-cart.test.ts asserts the opposite). So it is D-78 point 3, and it is raised rather than solved. The reorder path`s cart write was a different question and is already cut, through `cartWritePort.replaceItemsForCustomer`.',
  'modules/orders/services/order-service.ts:inventory/entities/stock-allocation.entity':
    'F3 Phase C — orders. **Escalated, not deferred.** The stock reservation is co-transactional with placement and has no foreign key to justify it under D-78 point 2: `stock_allocations.order_item_id` is `uuid not null` with no `references "order_items"` (inventory/migrations/20260503T182812_inventory_workflow.ts:199-211) — the same shape D-90 has just repaired for `shipments.order_id`. D-78 point 1 does not apply either: `reserve` cannot move inside `inventory` and keep its guarantee, because the `PESSIMISTIC_WRITE` lock on `stock_levels` has to be held until the order commits (test/contract/orders/place-stock-race.test.ts is the race it stops), and a separate transaction would leave `reserved` incremented for a placement that then rolls back. So it is D-78 point 3, and it is raised rather than solved.',
  'modules/orders/services/order-service.ts:inventory/entities/stock-level.entity':
    'F3 Phase C — orders. **Escalated, not deferred.** The stock reservation is co-transactional with placement and has no foreign key to justify it under D-78 point 2: `stock_allocations.order_item_id` is `uuid not null` with no `references "order_items"` (inventory/migrations/20260503T182812_inventory_workflow.ts:199-211) — the same shape D-90 has just repaired for `shipments.order_id`. D-78 point 1 does not apply either: `reserve` cannot move inside `inventory` and keep its guarantee, because the `PESSIMISTIC_WRITE` lock on `stock_levels` has to be held until the order commits (test/contract/orders/place-stock-race.test.ts is the race it stops), and a separate transaction would leave `reserved` incremented for a placement that then rolls back. So it is D-78 point 3, and it is raised rather than solved.',
  'modules/orders/services/order-service.ts:inventory/entities/warehouse.entity':
    'F3 Phase C — orders. **Escalated, not deferred.** The stock reservation is co-transactional with placement and has no foreign key to justify it under D-78 point 2: `stock_allocations.order_item_id` is `uuid not null` with no `references "order_items"` (inventory/migrations/20260503T182812_inventory_workflow.ts:199-211) — the same shape D-90 has just repaired for `shipments.order_id`. D-78 point 1 does not apply either: `reserve` cannot move inside `inventory` and keep its guarantee, because the `PESSIMISTIC_WRITE` lock on `stock_levels` has to be held until the order commits (test/contract/orders/place-stock-race.test.ts is the race it stops), and a separate transaction would leave `reserved` incremented for a placement that then rolls back. So it is D-78 point 3, and it is raised rather than solved.',
  'modules/orders/services/order-service.ts:inventory/services/effective-fulfilment-strategy':
    'F3 Phase C — orders. **Escalated, not deferred.** The stock reservation is co-transactional with placement and has no foreign key to justify it under D-78 point 2: `stock_allocations.order_item_id` is `uuid not null` with no `references "order_items"` (inventory/migrations/20260503T182812_inventory_workflow.ts:199-211) — the same shape D-90 has just repaired for `shipments.order_id`. D-78 point 1 does not apply either: `reserve` cannot move inside `inventory` and keep its guarantee, because the `PESSIMISTIC_WRITE` lock on `stock_levels` has to be held until the order commits (test/contract/orders/place-stock-race.test.ts is the race it stops), and a separate transaction would leave `reserved` incremented for a placement that then rolls back. So it is D-78 point 3, and it is raised rather than solved.',
  'modules/orders/services/order-service.ts:inventory/services/fulfilment-strategy-resolver':
    'F3 Phase C — orders. **Escalated, not deferred.** The stock reservation is co-transactional with placement and has no foreign key to justify it under D-78 point 2: `stock_allocations.order_item_id` is `uuid not null` with no `references "order_items"` (inventory/migrations/20260503T182812_inventory_workflow.ts:199-211) — the same shape D-90 has just repaired for `shipments.order_id`. D-78 point 1 does not apply either: `reserve` cannot move inside `inventory` and keep its guarantee, because the `PESSIMISTIC_WRITE` lock on `stock_levels` has to be held until the order commits (test/contract/orders/place-stock-race.test.ts is the race it stops), and a separate transaction would leave `reserved` incremented for a placement that then rolls back. So it is D-78 point 3, and it is raised rather than solved.',
  'modules/orders/services/order-service.ts:sql:inventory/warehouse_channel_assignments':
    'Issue #187 seed, ruled by D-94.4 — placement resolves channel → warehouse with ' +
    '`knexForStock(\'warehouse_channel_assignments as a\').join(\'warehouses as w\', …)`, ' +
    'two of `inventory`\'s tables joined by hand inside the placement transaction. Both ' +
    'predicates were blind to it: a builder names no import specifier and no SQL ' +
    'statement, which is why it stood while this shard was drained from 73 entries to ' +
    'nine. Retired by: `InventoryStockReadPort.listChannelWarehouses(salesChannelId)` — ' +
    '`listChannelAssignments` already exists and is one field (`warehouse.code`), one ' +
    'filter (`w.active`) and one ordering short of this query. `candidatesFor` must NOT ' +
    'be used for it: it reads through the owner\'s own `EntityManager`, so it neither ' +
    'takes nor holds the `PESSIMISTIC_WRITE` the placement race depends on.',
  'modules/orders/services/order-service.ts:sql:inventory/warehouses':
    'Issue #187 seed, ruled by D-94.4 — the second table of the same knex join described ' +
    'in the `warehouse_channel_assignments` entry above: `warehouses` supplies the code ' +
    'and the `active` filter the candidate ordering needs. One key per table, so the two ' +
    'retire together when `listChannelWarehouses` replaces the join.',
  'modules/orders/services/order-service.ts:invoices/entities/invoice.entity': {
    permanent: true,
    reason:
      'D-78 point 2, and the twin of the `payments` entry below. ' +
      '`db/migrations/20260425T050720_core_commerce_init.ts:195` declares `invoices_order_fk` ' +
      '(`invoices.order_id` -> `orders.id`, `on delete restrict`), so the proforma row ' +
      '`placeOrder` opens must see its order inside one transaction. `invoices` declares ' +
      '`orders`, so the manifest edge the constraint requires is already carried on that ' +
      'side; declaring the reverse would close a cycle `migration-order.ts` fails on. The ' +
      'read half of this module`s invoice surface is NOT here — the customer download and the ' +
      'admin bulk print go through `invoiceReadPort` / `invoicePdfPort` and are declared ' +
      '`degrades-without`. Only the co-transactional create is left.',
    retiredBy:
      'F4 gives `invoices` a package entry point exporting the row an order opens. Moving ' +
      'invoice creation out of the placement transaction — to an `order.created.v1` reactor — ' +
      'would retire it too, and is a product decision about whether a placed order may exist ' +
      'for a moment with no document.',
  },
  'modules/orders/services/order-service.ts:payments/entities/payment.entity': {
    permanent: true,
    reason:
      'D-78 point 2 — a co-transactional write the database holds together. ' +
      '`db/migrations/20260425T050720_core_commerce_init.ts:173` declares ' +
      '`payments_order_fk` (`payments.order_id` -> `orders.id`, `on delete restrict`), so the ' +
      'payment row `placeOrder` creates must see its order inside ONE transaction: a second ' +
      'transaction opened by a port on the `payments` side cannot satisfy a foreign key ' +
      'against a row it cannot see, and the order is not committed until placement returns. ' +
      'No port can carry the caller`s `EntityManager` without putting MikroORM into ' +
      '`@b2b/contracts` (FR-034), and D-77 refused the brand, the token and the ambient unit ' +
      'of work in writing. `orders` does not declare `payments` in `dependencies` because ' +
      '`payments` declares `orders` — the FK`s own direction — so the manifest edge that ' +
      'AGENTS.md § Migrations item 4 asks for is the one `payments` already carries. What ' +
      'crosses is one entity class, in one file, for one `tx.create`.',
    retiredBy:
      'F4 gives `payments` a package entry point that exports the row `orders` writes at ' +
      'placement — then this is a package dependency, not an import of internals. Moving the ' +
      'payment row out of the placement transaction would retire it too, and would cost the ' +
      'guarantee that an order and its payment appear together or not at all.',
  },
};
