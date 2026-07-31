import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 045 / US2 — per-promotion discount breakdown on placed orders.
 * The aggregate `orders.discount_total` is unchanged.
 */
export class Migration20260618T130459OrdersOrderAppliedPromotions extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "order_applied_promotions" (
        "id" uuid not null,
        "order_id" uuid not null,
        "promotion_id" uuid not null,
        "coupon_id" uuid null,
        "amount" numeric(14,2) not null,
        "currency" varchar(3) not null,
        constraint "order_applied_promotions_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `create index "idx_order_applied_promotions_order" on "order_applied_promotions" ("order_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "order_applied_promotions";`);
  }
}
