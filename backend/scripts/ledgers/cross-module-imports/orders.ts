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
 * Where a file reaches one target more than once, the entry carries `sites` and the number
 * is checked both ways (issue #267); an omitted `sites` means one. The key does not change
 * with the count — that is what keeps it stable across a move inside the file.
 *
 * "Retired by the cut merge request" is a reason only while the sweep runs.
 * After 2026-12-31 it stops being an acceptable one: an entry still carrying it
 * is a boundary the repository has decided to keep, and it needs a reason that
 * says so.
 *
 * **Nothing left here carries that sentence, and since D-94 nothing here is
 * draining either.** The `orders` cut drained 64 of this module's 73 entries
 * across five merge requests; D-94 settled the nine that were left. Every
 * remaining entry is `permanent: true`, which is the correct end state for
 * this module: everything standing is a row the placement transaction opens in
 * a neighbour's table, held by a foreign key, with a doc comment on both sides
 * naming the transaction it runs in.
 *
 *  - **six rows placement opens** — `payments` and `invoices` (D-78 point 2,
 *    settled when the entries were written) plus `carts` (two entries),
 *    `stock_allocations` and `stock_levels`, which were escalated under D-78
 *    point 3 for one reason: the constraint that would have justified them did
 *    not exist. D-94.1 adds all four — `carts_completed_order_fk`,
 *    `stock_allocations_order_item_fk` and, on the two sides that declare
 *    `orders` rather than being imported here,
 *    `promotion_usages_order_fk` and `credit_limit_reservations_order_fk`.
 *  - **one interface its owner writes** — `PromotionUsageFinalizer` (D-94.5).
 *    It names the caller's `EntityManager`, so FR-034 keeps it out of
 *    `@endora-commerce/contracts`; declaring it on the consumer's side, which is
 *    what this module used to do, left `lazyPort<T>`'s unchecked cast with
 *    nothing to check.
 *
 * **It was two, and the second is the first entry this shard has ever retired
 * by its own `retiredBy` sentence coming true** (feature 080, T040b). That
 * entry read *"F4 gives `credit_limits` a package entry point that exports this
 * interface — then it is a package dependency, not an import of internals"*.
 * `credit_limits` is `@endora-commerce/mod-credit-limits` now and
 * `CreditLimitPort` is published on its type-only `./ports` subpath, which
 * D-171 designates contract surface — derived from the artefact, since that
 * subpath's emitted module exports no runtime binding — so the reach is no
 * longer a reach. Nothing about the seam itself changed: the reservation still
 * runs on placement's `EntityManager`, `credit_limit_reservations_order_fk` is
 * untouched, and `orders` still acknowledges `creditLimitService` rather than
 * declaring the dependency back. What changed is that the interface now has a
 * name its owner offered. `PromotionUsageFinalizer` is the identical seam in
 * its pre-packaging spelling and retires the same way, when `promotions` is
 * packaged in its turn.
 *
 * Five entries left with D-94.4 rather than being settled: the
 * `warehouse.entity` fallback and both fulfilment resolvers are now
 * `inventoryStockReadPort.listChannelWarehouses` and
 * `inventoryFulfilmentPlanningPort`, and the two `sql:` reaches — the
 * channel→warehouse knex join issue #187 first made visible — went with them.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'modules/orders/services/order-service.ts:carts/entities/cart-item.entity': {
    permanent: true,
    reason:
      'D-78 point 2, settled by D-94.1 — a co-transactional write the database holds together. Placement ends by deleting the cart`s items, marking it `completed` and stamping `completed_order_id`, inside the placement transaction and on the same `Cart` object the totals were read from. Until D-94 there was no foreign key in either direction, which is why this entry was escalated rather than settled; `carts/migrations/20260818T081253_carts_cart_completed_order_fk.ts` adds `carts_completed_order_fk` (`carts.completed_order_id` -> `orders.id`, `on delete set null`), so the pointer cannot be written before the order exists and the order does not commit until placement returns. The **cart-side** column is what forces that: an `orders.cart_id` would have been satisfiable by completing the cart in a second transaction, because the cart is already committed when the order row is written. A `cartWritePort` call is still refused for the same reason it always was — it would leave a buyer with an emptied cart and no order whenever placement then fails (test/integration/orders/place-order-failure-preserves-cart.test.ts asserts the opposite). `carts` declares `orders` for the constraint, so the manifest edge is carried on that side; this module acknowledges `cartWritePort` rather than declaring `carts`, which would close a cycle. The reorder path`s cart write was a different question and is already cut, through `cartWritePort.replaceItemsForCustomer`.',
    retiredBy:
      'F4 gives `carts` a package entry point that exports the completion the placement transaction performs — then this is a package dependency, not an import of internals. Moving the completion out of the placement transaction would retire it too, and would cost the property test/integration/orders/place-order-failure-preserves-cart.test.ts asserts: a placement that fails leaves the basket exactly as the buyer left it.',
  },
  'modules/orders/services/order-service.ts:carts/entities/cart.entity': {
    permanent: true,
    reason:
      'D-78 point 2, settled by D-94.1 — a co-transactional write the database holds together. Placement ends by deleting the cart`s items, marking it `completed` and stamping `completed_order_id`, inside the placement transaction and on the same `Cart` object the totals were read from. Until D-94 there was no foreign key in either direction, which is why this entry was escalated rather than settled; `carts/migrations/20260818T081253_carts_cart_completed_order_fk.ts` adds `carts_completed_order_fk` (`carts.completed_order_id` -> `orders.id`, `on delete set null`), so the pointer cannot be written before the order exists and the order does not commit until placement returns. The **cart-side** column is what forces that: an `orders.cart_id` would have been satisfiable by completing the cart in a second transaction, because the cart is already committed when the order row is written. A `cartWritePort` call is still refused for the same reason it always was — it would leave a buyer with an emptied cart and no order whenever placement then fails (test/integration/orders/place-order-failure-preserves-cart.test.ts asserts the opposite). `carts` declares `orders` for the constraint, so the manifest edge is carried on that side; this module acknowledges `cartWritePort` rather than declaring `carts`, which would close a cycle. The reorder path`s cart write was a different question and is already cut, through `cartWritePort.replaceItemsForCustomer`.',
    retiredBy:
      'F4 gives `carts` a package entry point that exports the completion the placement transaction performs — then this is a package dependency, not an import of internals. Moving the completion out of the placement transaction would retire it too, and would cost the property test/integration/orders/place-order-failure-preserves-cart.test.ts asserts: a placement that fails leaves the basket exactly as the buyer left it.',
  },
  'modules/orders/services/order-service.ts:inventory/entities/stock-allocation.entity': {
    permanent: true,
    sites: 2,
    reason:
      'D-78 point 2, settled by D-94.1 — a co-transactional write the database holds together. `inventory/migrations/20260818T081243_inventory_stock_allocation_order_item_fk.ts` adds `stock_allocations_order_item_fk` (`stock_allocations.order_item_id` -> `order_items.id`, `on delete restrict`), so an allocation row cannot exist before its order item does and the order items are not committed until placement returns. Until D-94 the column was `uuid not null` with no constraint at all — the same statement that created it constrains `warehouse_id` and left this one bare, so the omission tracked the module boundary rather than a decision, and this entry was escalated for exactly that. D-78 point 1 still does not apply: `reserve` cannot move inside `inventory` and keep its guarantee, because the `PESSIMISTIC_WRITE` on `stock_levels` has to be held until the order commits (test/contract/orders/place-stock-race.test.ts is the race it stops). `inventory` declares `orders` for the constraint — the one edge of the family that closes no cycle; this module declares `inventory` `degrades-without` and skips the reservation whole when it is switched off.',
    retiredBy:
      'F4 gives `inventory` a package entry point that exports the reservation placement performs — then this is a package dependency, not an import of internals. Moving the reservation out of the placement transaction would retire it too, and would cost the `PESSIMISTIC_WRITE` on `stock_levels` that stops two placements allocating the same unit (test/contract/orders/place-stock-race.test.ts).',
  },
  'modules/orders/services/order-service.ts:inventory/entities/stock-level.entity': {
    permanent: true,
    sites: 2,
    reason:
      'D-78 point 2, settled by D-94.1, on the module-level reading of it — and the entry has to say so, because the constraint is on `stock_allocations` rather than on this table. The `PESSIMISTIC_WRITE` lock this class is loaded under, and the `reserved` increment it carries, are one operation with the allocation insert beside them: it is the allocation`s foreign key (`stock_allocations_order_item_fk`, `on delete restrict`) that pins the whole operation to the placement transaction, and splitting the lock off from the insert it protects would lose the race test/contract/orders/place-stock-race.test.ts asserts. Everything else the reservation used to reach into `inventory` for is gone (D-94.4): the channel -> warehouse binding and the default-warehouse fallback are `inventoryStockReadPort.listChannelWarehouses`, and both strategy resolvers are `inventoryFulfilmentPlanningPort`.',
    retiredBy:
      'F4 gives `inventory` a package entry point that exports the reservation placement performs — then this is a package dependency, not an import of internals. Moving the reservation out of the placement transaction would retire it too, and would cost the `PESSIMISTIC_WRITE` on `stock_levels` that stops two placements allocating the same unit (test/contract/orders/place-stock-race.test.ts).',
  },
  'modules/orders/services/order-service.ts:promotions/services/promotion-usage-finalizer': {
    permanent: true,
    reason:
      'D-94.5 — the twin of the `credit_limits` entry above, and the same shape. '
      + '`PromotionUsageFinalizer.finalizeUsage` takes the placement `EntityManager`, so '
      + 'FR-034 keeps it out of `@endora-commerce/contracts`; `promotions` declares it beside its '
      + 'implementation and this module imports the type, which is what gives `tsc` something '
      + 'to check both ends against. The read half is NOT here: `applyToCart` is '
      + '`PromotionApplyPort` in the contracts package, resolved under the same container '
      + 'name `carts` already uses, and the consumer-declared duplicate of it was deleted '
      + 'with `PromotionPort`. The seam is held by `promotion_usages_order_fk` '
      + '(`promotion_usages.order_id` -> `orders.id`, `on delete restrict`): the redemption '
      + 'row cannot exist before the order does, and a cap hit at the last moment has to roll '
      + 'the placement back with it. `promotions` declares `orders` for the constraint; this '
      + 'module acknowledges `promotionService` and `promotionUsageFinalizer` rather than '
      + 'declaring it back, which would close a cycle.',
    retiredBy:
      'F4 gives `promotions` a package entry point that exports this interface — then it is a '
      + 'package dependency, not an import of internals. Moving usage finalization out of the '
      + 'placement transaction would retire it too, and would cost SC-005: two carts racing '
      + 'for a coupon`s final use could both succeed.',
  },
  'modules/orders/services/order-service.ts:invoices/entities/invoice.entity': {
    permanent: true,
    reason:
      'D-78 point 2, and the twin of the `payments` entry below. ' +
      '`db/migrations/20260425T050720_core_commerce_init.ts:195` declares `invoices_order_fk` ' +
      '(`invoices.order_id` -> `orders.id`, `on delete restrict`), so the proforma row ' +
      '`placeOrder` opens must see its order inside one transaction. `invoices` declares ' +
      '`orders`, so the manifest edge the constraint requires is already carried on that ' +
      'side; declaring the reverse would close a cycle `module-graph.test.ts` fails on. The ' +
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
      '`@endora-commerce/contracts` (FR-034), and D-77 refused the brand, the token and the ambient unit ' +
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
