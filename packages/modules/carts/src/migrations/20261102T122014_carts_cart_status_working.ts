import { Migration } from '@mikro-orm/migrations';

/**
 * Issue #169 — `carts.status` gains `working`: the basket an order is placed
 * from on the customer's behalf (admin order creation, one-click buy, the
 * external order intake), written from the request's lines **beside** the
 * customer's active basket instead of in place of it. Until now those three
 * paths emptied the active basket and closed it as `completed` with no order.
 *
 * A working basket is outside `carts_one_active_per_customer_per_channel` (a
 * partial index on `status = 'active'`), so it needs nothing else here. It ends
 * `completed` with `completed_order_id` set, or is deleted when the placement
 * is refused.
 *
 * `down` deletes any working basket left behind — none is anybody's basket,
 * and the narrowed constraint could not hold it — before narrowing back.
 */
export class Migration20261102T122014CartsCartStatusWorking extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "carts" drop constraint if exists "carts_status_check";`);
    this.addSql(`
      alter table "carts"
        add constraint "carts_status_check"
        check ("status" in ('active', 'abandoned', 'completed', 'rejected', 'working'));
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`delete from "carts" where "status" = 'working';`);
    this.addSql(`alter table "carts" drop constraint if exists "carts_status_check";`);
    this.addSql(`
      alter table "carts"
        add constraint "carts_status_check"
        check ("status" in ('active', 'abandoned', 'completed', 'rejected'));
    `);
  }
}
