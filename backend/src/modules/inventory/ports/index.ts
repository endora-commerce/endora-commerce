/**
 * The port interfaces `inventory` publishes whose signature carries a MikroORM
 * `EntityManager`, and **nothing that exists at runtime** (feature 080, T048;
 * D-169, D-171).
 *
 * `tsc` compiles this file to `export {};`. That is the property D-171 makes
 * the boundary decision on — *a subpath is contract surface iff the module it
 * resolves to exports no runtime binding* — and it is why this declaration has
 * its own file rather than sitting on top of a service module, which exports
 * the class beside it. A consumer naming that file names the owner's
 * implementation, whatever `import type` erases; a consumer naming this one
 * names a declaration and can name nothing else.
 *
 * **This is not yet a supported specifier and the ledger still counts it.**
 * `inventory` is not a workspace package, so there is no `exports` map for this
 * to be a subpath of, and `check:module-boundary` reads `orders`' relative
 * import exactly as it read the two entity imports it replaces — D-171 says so
 * in as many words: `resolveModulePackage` returns `null` for any specifier
 * starting with `.`, so an unconverted reach has no subpath for the exemption
 * to apply to, and reaching the exempt state takes three separable edits
 * (package the owner, publish the interface, rewrite the specifier). This file
 * is the second of those three, taken early because it is the one that does not
 * need the module to move.
 *
 * The rest of this module's surface is in `@endora-commerce/contracts` and
 * belongs there — `InventoryStockReadPort`, `InventoryFulfilmentPlanningPort`,
 * `InventoryStockImportPort` and `InventoryProductThresholdWritePort` are
 * contract DTOs end to end, and the planning port is pure over its arguments.
 * This one qualifies for `./ports` on D-171's own test — *"does this signature
 * stop the interface living in `packages/contracts`"* — and the answer is its
 * `EntityManager` parameter, which that package may not name because `admin`
 * and `storefront` both compile it (FR-034).
 *
 * No entity class leaves by this door, type-only included (D-168).
 */
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * What one candidate warehouse holds for one order line, under the write lock
 * {@link InventoryReservationApplyPort.lockAvailabilityForPlacement} took — a
 * published record and never the managed `stock_levels` row (D-77's first
 * narrowing).
 *
 * `available` is `onHand - reserved` at the moment of the lock, and is `0` for
 * a warehouse that holds no row for the line at all: an absent row and a row at
 * zero are the same answer to *"how many can I promise"*, and the difference —
 * whether an `insert` or an `update` follows — is this module's to know.
 */
export interface PlacementStockSnapshot {
  readonly warehouseId: string;
  readonly available: number;
}

/**
 * Container name: `inventoryReservationApplyPort`. Owner: `inventory`.
 *
 * The stock reservation order placement performs, run on the **caller's**
 * `EntityManager` (D-169). `orders` is the one consumer, and the four methods
 * are the four steps of one protocol: lock the candidates, apply the plan,
 * record the allocations once the order items exist, and release them if the
 * order is later cancelled.
 *
 * **The seam is not a defect in the design, it *is* the design.**
 * `stock_allocations_order_item_fk` (`stock_allocations.order_item_id` ->
 * `order_items.id`, `on delete restrict`,
 * `inventory/migrations/20260818T081243_inventory_stock_allocation_order_item_fk.ts`)
 * means an allocation row cannot exist before its order item does, and the
 * order items are not committed until placement returns — so a port that opened
 * its own transaction could not satisfy a foreign key against rows it cannot
 * see. The `PESSIMISTIC_WRITE` on `stock_levels` is the other half of the same
 * fact: it has to be held by the transaction that writes the order, or two
 * placements allocate the same unit
 * (`test/contract/orders/place-stock-race.test.ts`), and a `reserved` increment
 * committed separately would survive a placement that then rolled back. A
 * foreign key needs the **table** and never the class (D-169), so that
 * constraint stands while this module publishes no entity class by name.
 *
 * **The policy half is not here, and neither is the read half.** Which
 * warehouse a line is allocated to is `InventoryFulfilmentPlanningPort`, pure
 * over its arguments; the channel → warehouse binding and every standalone
 * stock read are `InventoryStockReadPort`, on this module's own
 * `EntityManager`. Both live in `@endora-commerce/contracts` and stay there. A
 * read handed an `EntityManager` is a write seam re-opened to serve a read
 * (D-169), and `candidatesFor` is the worked example of the difference: it
 * answers the richer question and answers it outside the caller's transaction,
 * which is precisely why it cannot take the lock this port's first method
 * takes.
 *
 * **Owner off:** this module is switchable (`inventory.enabled`), and `orders`
 * declares the edge `degrades-without` rather than binding it —
 * `stock_allocations_order_item_fk` obliges `inventory` to declare `orders`, so
 * the edge cannot be declared back, and an acknowledged edge would keep the
 * bind and make that control unusable, because `orders` is non-deactivatable.
 * So placement asks the effective-state seam for this module's own id once,
 * before the reservation block, and skips it whole; the cancellation path asks
 * the same question before releasing. The literal is deliberately not spelled
 * here: `check-entry-presence`'s tree proof blanks that expression out of the
 * one file of each module that carries it, and a second file carrying it in
 * prose makes that proof ambiguous. With this module off an order is placed without
 * reserving stock and a cancellation releases nothing — which is what
 * `inventory.enabled`'s own description promises an operator, and what the
 * platform did **not** do before D-94.4, when every placement locked
 * `stock_levels`, incremented `reserved` and inserted `stock_allocations` rows
 * with the module switched off (issue #188).
 */
export interface InventoryReservationApplyPort {
  /**
   * Lock the line's row in each candidate warehouse under
   * `PESSIMISTIC_WRITE` and answer what each holds.
   *
   * `em` is **required** (D-169). Its one caller is `placeOrder`, which always
   * passes the `EntityManager` its own transaction runs on; an optional
   * parameter is what lets the same method double as a standalone read, and
   * that is a lie about a lock whose whole content is that it is held until the
   * order commits. The standalone read is a different method on a different
   * port and takes no `EntityManager`: `InventoryStockReadPort.candidatesFor`.
   *
   * One entry per requested warehouse, in the order requested, so the caller
   * can zip it against the channel binding it already holds.
   */
  lockAvailabilityForPlacement(
    em: EntityManager,
    input: {
      productId: string;
      variantId: string | null;
      warehouseIds: readonly string[];
    },
  ): Promise<PlacementStockSnapshot[]>;
  /**
   * Apply the allocation plan: raise `reserved` by the planned quantity in each
   * named warehouse, opening a row at `onHand = 0` where the line has none.
   *
   * Runs on the same `em` as the lock above, and is the write that lock exists
   * to protect. It is not flushed here: the caller's transaction flushes it
   * beside the order items whose foreign key holds the allocation rows, which
   * is the statement order the reservation has always had.
   */
  reserveForPlacement(
    em: EntityManager,
    input: {
      productId: string;
      variantId: string | null;
      allocations: ReadonlyArray<{ warehouseId: string; quantity: number }>;
    },
  ): Promise<void>;
  /**
   * Record one allocation row per `(order item, warehouse)` pair, so an admin
   * can trace fulfilment provenance and so cancellation has something to
   * release.
   *
   * Called **after** the order items are flushed and required to be:
   * `stock_allocations_order_item_fk` is `on delete restrict`, so the row
   * cannot exist before its order item does.
   */
  recordAllocationsForOrderItems(
    em: EntityManager,
    input: {
      allocations: ReadonlyArray<{
        orderItemId: string;
        warehouseId: string;
        quantity: number;
        isBackorder: boolean;
      }>;
    },
  ): Promise<void>;
  /**
   * Release every un-released allocation held by the named order items,
   * decrementing each affected `reserved` counter and stamping `released_at`.
   *
   * Idempotent: a second run over the same items releases nothing, because
   * already-released rows are filtered out by `released_at is null`. `em` is
   * the transaction the caller opened for the cancellation — a different
   * transaction from placement's, and required for the same reason: the
   * counter decrement and the `released_at` stamp are one operation.
   *
   * The caller passes the line's product and variant because `stock_allocations`
   * records the warehouse and the order item and not the product; resolving it
   * here would mean this module reading `order_items`, which belongs to
   * `orders`.
   */
  releaseForOrderItems(
    em: EntityManager,
    input: {
      items: ReadonlyArray<{
        orderItemId: string;
        productId: string;
        variantId: string | null;
      }>;
    },
  ): Promise<{ released: number }>;
}
