import { Migration } from '@mikro-orm/migrations';

/**
 * Issue #417 (owner ruling of 2026-10-24) — `orders.vat_method`: the VAT method
 * the order was placed under. `per_rate` — VAT per rate on the sum of the
 * nets, rounded once (`vatByRate`) — is written by placement from 0.108.0.
 *
 * Nullable, no backfill: `null` is an order placed before the per-rate method,
 * whose stored totals and line totals were computed by the rule of its day.
 * What such an order charged is read from what it stored, never recomputed —
 * the returns of a legacy order refund what it actually charged.
 */
export class Migration20261024T145147OrdersVatMethod extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "orders" add column if not exists "vat_method" varchar(16) null;');
    this.addSql('alter table "orders" drop constraint if exists "orders_vat_method_check";');
    this.addSql(
      `alter table "orders" add constraint "orders_vat_method_check" check ("vat_method" is null or "vat_method" in ('per_rate'));`,
    );
  }

  override async down(): Promise<void> {
    this.addSql('alter table "orders" drop constraint if exists "orders_vat_method_check";');
    this.addSql('alter table "orders" drop column if exists "vat_method";');
  }
}
