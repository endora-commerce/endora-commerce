import { Migration } from '@mikro-orm/migrations';

/**
 * Customer-facing business Order ID (feature 036 — Kasa / Checkout).
 *
 * Adds `orders.business_id`: a human, business-facing identifier shown to the
 * Customer instead of the internal UUID `id`. Its numeric core comes from a
 * dedicated monotonic sequence (`orders_business_id_seq`); the optional
 * prefix/suffix are admin-configurable via the `orders.business_id.*`
 * settings and are applied at placement by OrderService — not here.
 *
 * Strategy:
 *   1. create the sequence,
 *   2. add a nullable `business_id` column,
 *   3. backfill every existing order with `'' || nextval || ''` (empty
 *      default prefix/suffix → the bare number),
 *   4. tighten to NOT NULL + UNIQUE.
 */
export class Migration053OrdersBusinessId extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create sequence if not exists "orders_business_id_seq";`);
    this.addSql(`alter table "orders" add column "business_id" varchar(128) null;`);
    // Backfill existing rows from the sequence; empty default prefix/suffix.
    this.addSql(
      `update "orders" set "business_id" = nextval('orders_business_id_seq')::text where "business_id" is null;`,
    );
    this.addSql(`alter table "orders" alter column "business_id" set not null;`);
    this.addSql(
      `alter table "orders" add constraint "orders_business_id_unique" unique ("business_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "orders" drop constraint "orders_business_id_unique";`);
    this.addSql(`alter table "orders" drop column "business_id";`);
    this.addSql(`drop sequence if exists "orders_business_id_seq";`);
  }
}
