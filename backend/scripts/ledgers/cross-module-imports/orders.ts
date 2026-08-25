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
 *  - **the rows placement opens in a neighbour's table** — `payments` and
 *    `invoices` (D-78 point 2, settled when the entries were written) plus
 *    `carts`, `stock_allocations` and `stock_levels`, which were escalated
 *    under D-78 point 3 for one reason: the constraint that would have
 *    justified them did not exist. D-94.1 adds all four —
 *    `carts_completed_order_fk`, `stock_allocations_order_item_fk` and, on the
 *    two sides that declare `orders` rather than being imported here,
 *    `promotion_usages_order_fk` and `credit_limit_reservations_order_fk`.
 *
 * **Feature 080's T048 converts what crosses on three of them, and moves no
 * transaction and no constraint** (D-169). `carts`, `invoices` and `inventory`
 * were entity classes used as MikroORM repository handles —
 * `em.findOne(Cart, …)`, `tx.create(Invoice, …)`, `tx.create(StockAllocation, …)`
 * — and D-168 leaves a packaged owner no supported spelling for one, so each is
 * now that owner's own `EntityManager`-taking interface on its own `ports/`
 * directory, and the owner writes its own rows. The three carts keys became one
 * (two entity classes, one interface) and so did the two `inventory` ones. The
 * `payments` entry is unchanged and is the last of the family in this file:
 * converting it forces a product decision about what checkout does when an
 * operator has switched `payments` off, because the port that would replace the
 * `tx.create` is gated and `payments.enabled` is a real control. That decision
 * is worth more than the conversion and is not this merge request's to make.
 *
 * **`inventory`'s pair was spelled twice and only one spelling was written
 * down.** The static imports carried a comment saying D-94.4 had replaced the
 * `await import()` form; it had not — `releaseAllocations` still held both
 * classes dynamically, invisible to a reviewer scanning the import block, which
 * is exactly the property a permanent boundary exception must not have. That is
 * why the two keys carried `sites: 2` each and why the one key that replaces
 * them carries one.
 *
 * Every converted entry stays, and stays `permanent: true`, exactly as D-171
 * predicts: `resolveModulePackage` returns `null` for any specifier starting
 * with `.`, so a relative import into an owner's `ports/` directory has no
 * subpath for the exemption to apply to. Each `retiredBy` names the packaging
 * that finishes it.
 *
 * **There were two more, and both are gone — the only entries this shard has
 * ever retired by their own `retiredBy` sentence coming true** (feature 080,
 * T040b). Each read *"F4 gives `<module>` a package entry point that exports
 * this interface — then it is a package dependency, not an import of
 * internals"*. `credit_limits` is `@endora-commerce/mod-credit-limits` and
 * `CreditLimitPort` is on its type-only `./ports` subpath; `promotions` is
 * `@endora-commerce/mod-promotions` and `PromotionUsageFinalizer` is on its
 * own. D-171 designates such a subpath contract surface — derived from the
 * artefact, since its emitted module exports no runtime binding — so neither
 * reach is a reach any more.
 *
 * **Nothing about either seam changed, and that is the point of the ruling.**
 * The reservation and the redemption still run on placement's own
 * `EntityManager`; `credit_limit_reservations_order_fk` and
 * `promotion_usages_order_fk` are untouched; both owners still declare `orders`
 * for their constraint while this module goes on acknowledging
 * `creditLimitService`, `promotionService` and `promotionUsageFinalizer` rather
 * than declaring the dependency back, which would close a cycle. What changed
 * is that each interface now has a name its owner offered.
 *
 * The **`ledger-size`** figure does not move for either retirement, and that is
 * the expected reading rather than a surprise: both entries were
 * `permanent: true`, and D-77 excludes a permanent entry from that count on the
 * ground that an edge a foreign key holds co-transactional is not debt. What
 * moves is the permanent total, by one per packaged owner.
 *
 * Five entries left with D-94.4 rather than being settled: the
 * `warehouse.entity` fallback and both fulfilment resolvers are now
 * `inventoryStockReadPort.listChannelWarehouses` and
 * `inventoryFulfilmentPlanningPort`, and the two `sql:` reaches — the
 * channel→warehouse knex join issue #187 first made visible — went with them.
 */
import type { LedgerEntry } from '../../check-module-boundary.js';

export const entries: Readonly<Record<string, LedgerEntry>> = {
  'modules/orders/services/order-service.ts:carts/ports/index': {
    permanent: true,
    reason:
      'D-78 point 2, settled by D-94.1 and converted by feature 080`s T048 — a co-transactional write the database holds together, now expressed as the owner`s own `EntityManager`-taking interface instead of its two entity classes. Placement reads the basket it is turning into an order and then, once the order exists, deletes its lines, marks it `completed` and stamps `completed_order_id`, all on the placement `EntityManager`. `carts/migrations/20260818T081253_carts_cart_completed_order_fk.ts` adds `carts_completed_order_fk` (`carts.completed_order_id` -> `orders.id`, `on delete set null`), so the pointer cannot be written before the order exists and the order does not commit until placement returns. The **cart-side** column is what forces that: an `orders.cart_id` would have been satisfiable by completing the cart in a second transaction, because the cart is already committed when the order row is written. A `cartWritePort` call is still refused for the same reason it always was — it opens its own transaction, so it would leave a buyer with an emptied cart and no order whenever placement then fails (test/integration/orders/place-order-failure-preserves-cart.test.ts asserts the opposite). What T048 removed is the entity class, which D-168 leaves a packaged `carts` no supported spelling for: the foreign key needs the **table** and never the class (D-169), so the constraint is untouched and what crosses is `CartWithItems`, published records rather than two managed rows this module could have moved any column of. One site: the `import type` of `CartPlacementApplyPort`. The standalone read this file also makes — the storefront total preview, which opens no transaction — is `CartReadPort` in `@endora-commerce/contracts` and is therefore no reach at all; that is D-169`s rule that a read handed an `EntityManager` is a write seam re-opened to serve a read, and it is why there are two `carts` names here rather than one widened interface. `carts` declares `orders` for the constraint, so the manifest edge is carried on that side; this module acknowledges `cartPlacementApplyPort` and `cartReadPort` rather than declaring `carts`, which would close a cycle.',
    retiredBy:
      'F4 packages `carts`, at which point that same directory is the package`s `./ports` subpath, D-171 stops counting the reach, and the consumer-side edit is this one specifier. It is not retired by the relocation alone: `resolveModulePackage` returns `null` for anything starting with `.`, so a relative specifier has no subpath for the exemption to apply to, and the three edits (package the owner, publish the interface, rewrite the specifier) are separable by design — this entry stands with the second done. Moving the completion out of the placement transaction would retire it too, and would cost the property test/integration/orders/place-order-failure-preserves-cart.test.ts asserts: a placement that fails leaves the basket exactly as the buyer left it.',
  },
  'modules/orders/services/order-service.ts:inventory/ports/index': {
    permanent: true,
    reason:
      'D-78 point 2, settled by D-94.1 and converted by feature 080`s T048 — a co-transactional write the database holds together, now expressed as the owner`s own `EntityManager`-taking interface instead of its `StockLevel` and `StockAllocation` classes. `inventory/migrations/20260818T081243_inventory_stock_allocation_order_item_fk.ts` adds `stock_allocations_order_item_fk` (`stock_allocations.order_item_id` -> `order_items.id`, `on delete restrict`), so an allocation row cannot exist before its order item does and the order items are not committed until placement returns; the `PESSIMISTIC_WRITE` on `stock_levels` is the other half of the same fact, because it has to be held by the transaction that writes the order or two placements allocate the same unit (test/contract/orders/place-stock-race.test.ts). D-78 point 1 still does not apply for that reason: `reserve` cannot move inside `inventory` and keep its guarantee. What T048 removed is the entity classes, which D-168 leaves a packaged `inventory` no supported spelling for: the foreign key needs the **table** and never the class (D-169), so both constraints are untouched and what crosses is `PlacementStockSnapshot`, published records rather than managed rows this module could have moved any column of. **Two spellings went, not one** — the static pair at the top of the file, and an `await import()` inside `releaseAllocations` that the comment above the static pair claimed D-94.4 had already removed; !1013 reported that and did not repair it. One site: the `import type` of `InventoryReservationApplyPort`. `inventory` declares `orders` for the constraint — the one edge of the family that closes no cycle; this module declares `inventory` `degrades-without` and, since T048, skips the release as well as the reservation when it is switched off.',
    retiredBy:
      'F4 packages `inventory`, at which point that same directory is the package`s `./ports` subpath, D-171 stops counting the reach, and the consumer-side edit is this one specifier. It is not retired by the relocation alone: `resolveModulePackage` returns `null` for anything starting with `.`, so a relative specifier has no subpath for the exemption to apply to, and the three edits (package the owner, publish the interface, rewrite the specifier) are separable by design — this entry stands with the second done. Moving the reservation out of the placement transaction would retire it too, and would cost the `PESSIMISTIC_WRITE` on `stock_levels` that stops two placements allocating the same unit (test/contract/orders/place-stock-race.test.ts).',
  },
  'modules/orders/services/order-service.ts:invoices/ports/index': {
    permanent: true,
    reason:
      'D-78 point 2, converted by feature 080`s T048 — the twin of the `payments` entry below, one edit ahead of it. ' +
      '`db/migrations/20260425T050720_core_commerce_init.ts:195` declares `invoices_order_fk` ' +
      '(`invoices.order_id` -> `orders.id`, `on delete restrict`), so the proforma row ' +
      '`placeOrder` opens must see its order inside one transaction. What crosses is now the ' +
      'owner`s `EntityManager`-taking interface rather than its `Invoice` class, which is ' +
      'what D-168 leaves a packaged `invoices` no supported spelling for; the constraint is ' +
      'untouched, because a foreign key needs the **table** and never the class (D-169), and ' +
      'the row is written by the module that owns the table. `invoices` declares ' +
      '`orders`, so the manifest edge the constraint requires is already carried on that ' +
      'side; declaring the reverse would close a cycle `module-graph.test.ts` fails on, and ' +
      'acknowledging it would keep the bind and make `invoices.enabled` unusable — so the ' +
      'edge is `degrades-without` and placement asks presence before the call. The ' +
      'read half of this module`s invoice surface is NOT here — the customer download and the ' +
      'admin bulk print go through `invoiceReadPort` / `invoicePdfPort` and are declared ' +
      '`degrades-without` too. Only the co-transactional create is left.',
    retiredBy:
      'F4 packages `invoices`, at which point that same directory is the package`s `./ports` ' +
      'subpath, D-171 stops counting the reach, and the consumer-side edit is this one ' +
      'specifier — the second of D-171`s three separable edits is done and this entry stands ' +
      'with it. Moving invoice creation out of the placement transaction — to an ' +
      '`order.created.v1` reactor — would retire it too, and is a product decision about ' +
      'whether a placed order may exist for a moment with no document.',
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
