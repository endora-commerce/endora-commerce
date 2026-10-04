import type { EntityManager } from '@mikro-orm/postgresql';
import type { InventoryReservationApplyPort } from '@endora-commerce/mod-inventory/ports';

/**
 * Release every stock allocation an order still holds, through `inventory`'s
 * port — the one statement of how `orders` gives stock back.
 *
 * It has two callers and they must not drift: `OrderService.releaseAllocations`
 * and the `stock.release` follow-up of a cancellation
 * (`specs/142-order-transition-atomicity/`, D2). The follow-up cannot call the
 * service method: `OrderService` is built when the routes register, and the
 * follow-up also runs where no route ever registers — the operator's repair
 * command composes the platform without building a server.
 *
 * **Both tables are written by their owner.** This reads `order_items`, which
 * `orders` owns, and hands the lines to the port; `stock_allocations` and
 * `stock_levels` are written on the other side of the seam, on the transaction
 * opened here, so the counter decrement and the `released_at` stamp are one
 * operation. The lines are passed in because an allocation records the
 * warehouse and the order item and not the product: resolving it on the other
 * side would mean `inventory` reading `order_items`.
 *
 * Idempotent — already-released rows are filtered out by `released_at is null`
 * on the owner's side, so a second run releases nothing.
 *
 * **The caller decides presence first.** `inventory` is switchable, and the
 * port is gated: this function resolves it and so must only be reached once
 * the caller knows the module is present.
 */
export async function releaseOrderAllocations(
  emFactory: () => EntityManager,
  reservationApply: InventoryReservationApplyPort,
  orderId: string,
): Promise<{ released: number }> {
  return emFactory().transactional(async (tx) => {
    // One stock release per order at a time. `inventory`'s release takes no
    // row lock of its own, so two overlapping runs could both read an
    // allocation as held and both decrement the counter. The follow-up queue
    // keeps runs apart with a lease, and a lease can expire under a release
    // that is merely slow; this lock is what makes that harmless — the second
    // run waits here, and then finds `released_at` already stamped. It is held
    // for this short transaction only, on a row this module owns.
    await tx.execute(`select 1 from "orders" where "id" = ? for update`, [orderId]);
    // `tx.execute`, not `tx.getKnex()`: the knex instance is connection-level
    // and carries no transaction context, so the read would take its own pooled
    // connection and could not see anything this transaction had written
    // (issue #200).
    const itemRows = await tx.execute<
      Array<{ id: string; product_id: string; variant_id: string | null }>
    >(
      `select "id", "product_id", "variant_id"
         from "order_items"
        where "order_id" = ?`,
      [orderId],
    );
    if (itemRows.length === 0) return { released: 0 };

    return reservationApply.releaseForOrderItems(tx, {
      items: itemRows.map((r) => ({
        orderItemId: r.id,
        productId: r.product_id,
        variantId: r.variant_id ?? null,
      })),
    });
  });
}
