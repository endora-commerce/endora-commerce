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
 * **Feature 080's T048 converts what crosses on every one of them, and moves no
 * transaction and no constraint** (D-169). `carts`, `invoices`, `inventory` and
 * `payments` were entity classes used as MikroORM repository handles —
 * `em.findOne(Cart, …)`, `tx.create(Invoice, …)`, `tx.create(StockAllocation, …)`,
 * `tx.create(Payment, …)` — and D-168 leaves a packaged owner no supported
 * spelling for one, so each is now that owner's own `EntityManager`-taking
 * interface on its own `ports/` directory, and the owner writes its own rows.
 * The three carts keys became one (two entity classes, one interface) and so did
 * the two `inventory` ones.
 *
 * **`payments` was the last, and it was deferred by a question that turned out
 * to have been already answered** (D-179). Converting it was held to force a
 * product decision — what does checkout do when an operator has switched
 * `payments` off — because the port replacing the `tx.create` is gated and
 * `payments.enabled` is a real control. The analysis commissioned to settle it
 * refuted its own premise: that module contributes all four built-in payment
 * adapters, the adapter registry filters its enumeration on the contributor's
 * effective state, and `assertPaymentMethodUsable` already throws
 * `ModuleDisabledError`. Checkout was already fail-closed, and fails closed
 * where no money is at stake. So the conversion is a plain `lazyPort` with no
 * presence probe: it changes no reachable behaviour and closes the one real
 * hole, an adapter *no module registered* writing a row into that module's table
 * while it is off — issue #188's shape, one table over.
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
  'modules/orders/services/order-service.ts:payments/ports/index': {
    permanent: true,
    reason:
      'D-78 point 2 — a co-transactional write the database holds together. ' +
      '`db/migrations/20260425T050720_core_commerce_init.ts:173` declares ' +
      '`payments_order_fk` (`payments.order_id` -> `orders.id`, `on delete restrict`), so the ' +
      'payment row `placeOrder` opens must see its order inside ONE transaction: a second ' +
      'transaction opened by a port on the `payments` side cannot satisfy a foreign key ' +
      'against a row it cannot see, and the order is not committed until placement returns. ' +
      '`orders` does not declare `payments` in `dependencies` because `payments` declares ' +
      '`orders` — the FK`s own direction — so the manifest edge that AGENTS.md § Migrations ' +
      'item 4 asks for is the one `payments` already carries; the port edge back is ' +
      '`refuses-without`, which withdraws the bind an acknowledgement would keep. ' +
      '**Feature 080`s T048 converted what crosses, and nothing else** (D-169, D-179): it was ' +
      'the `Payment` entity class, the last cross-module entity-class reach in the tree, and ' +
      'it is now `PaymentPlacementApplyPort` — the owner`s own interface in the owner`s ' +
      '`ports/` directory, because its `EntityManager` parameter bars it from ' +
      '`@endora-commerce/contracts` (FR-034), where D-77 had already refused the brand, the ' +
      'token and the ambient unit of work in writing. The transaction and the constraint are ' +
      'exactly as they were; a foreign key needs the **table** and never the class. What the ' +
      'conversion removed is this module`s ability to move any other column of `payments`` ' +
      'aggregate on a transaction it happens to hold — the port answers published records ' +
      'and hands back no managed row, so even the credit-limit branch`s `deferred` stamp is ' +
      'now the owner`s own named operation. And it closed a hole: the row was written into ' +
      'that module`s table with an operator having switched it off, on the one path ' +
      '`assertPaymentMethodUsable` tolerates (an adapter no module registered), which is ' +
      'issue #188`s shape one table over.',
    retiredBy:
      'F4 packages `payments`, at which point that same directory is the package`s `./ports` ' +
      'subpath, D-171 stops counting the reach, and the consumer-side edit is this one ' +
      'specifier. It is not retired by the relocation alone: `resolveModulePackage` returns ' +
      '`null` for anything starting with `.`, so a relative specifier has no subpath for the ' +
      'exemption to apply to, and the three edits (package the owner, publish the interface, ' +
      'rewrite the specifier) are separable by design — this entry stands with the second ' +
      'done. Moving the payment row out of the placement transaction would retire it too, ' +
      'and would cost the guarantee that an order and its payment appear together or not at ' +
      'all.',
  },
};
