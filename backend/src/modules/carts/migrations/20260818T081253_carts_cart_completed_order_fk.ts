import { Migration } from '@mikro-orm/migrations';

/**
 * `carts.completed_order_id` — the pointer this table has never had for one of
 * its two terminal transitions (D-94.1, site 2 / D-94.4).
 *
 * `placeOrder` ends by deleting the cart's items and setting
 * `status = 'completed'`, on the same `Cart` object the totals were read from
 * and inside the placement transaction, because a placement that then fails
 * must leave the basket exactly as the buyer left it
 * (`test/integration/orders/place-order-failure-preserves-cart.test.ts`).
 * D-78 point 2 rules such a seam permanent and *declared*, and there was
 * nothing to declare it with: no foreign key existed in either direction.
 *
 * **The pointer goes on the cart, not on the order.** An `orders.cart_id`
 * would satisfy the letter of D-78 point 2 and force nothing — `orders`
 * already declares `carts`, and an implementer could still complete the cart
 * in a separate transaction and satisfy the constraint, because the cart is
 * already committed when the order row is written. The cart-side pointer
 * cannot be written before the order exists, which is precisely the property
 * `payments_order_fk`, `invoices_order_fk` and `shipments_order_fk` rely on.
 * This table already carries exactly this shape for its *other* terminal
 * transition — `carts_converted_to_qr_fk`, added by
 * `20260611T140352_carts_consolidation.ts:100-109`.
 *
 * `null`, and `on delete set null`, for the reason that migration wrote down
 * for its twin: deleting the target does not invalidate the fact that the cart
 * was once completed. The completion pointer is provenance, not a dependency.
 * The column is nullable because it cannot be backfilled — no surviving record
 * says which order emptied which historical cart — and because three of the
 * four paths to `completed` are not placements (`CartService.clearForCustomer`,
 * the anonymous-merge source, and the quote-request conversion), so
 * `status = 'completed'` will never imply it and no check constraint can be
 * added.
 *
 * **No orphan report, and the asymmetry is the point.** The other three
 * constraints of this family need one because their columns have been
 * accepting unverified values for months. This column is new: every existing
 * row starts `null`, so there is nothing to orphan.
 *
 * `carts` declares `orders` in its manifest `dependencies` for this edge
 * (AGENTS.md § Migrations item 4). The reverse port edge — `orders` resolving
 * `cartWritePort` — moves to `acknowledgedDependencies`, which drops the
 * install ordering the constraint says is backwards and keeps the bind and
 * every refusal exactly as they were (D-94.3).
 */
export class Migration20260818T081253CartsCartCompletedOrderFk extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "carts" add column "completed_order_id" uuid null;`);
    this.addSql(`
      alter table "carts"
        add constraint "carts_completed_order_fk" foreign key ("completed_order_id")
          references "orders" ("id") on delete set null;
    `);
    this.addSql(
      `create index "carts_completed_order_idx" on "carts" ("completed_order_id") where "completed_order_id" is not null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "carts_completed_order_idx";`);
    this.addSql(`alter table "carts" drop constraint if exists "carts_completed_order_fk";`);
    this.addSql(`alter table "carts" drop column if exists "completed_order_id";`);
  }
}
