import { Migration } from '@mikro-orm/migrations';

/**
 * Issue #904, Phase A — the columns delivery and the payment surcharge will
 * carry the goods' VAT in (owner ruling of 2026-11-07: a charge takes the rate
 * of the goods it accompanies).
 *
 * - `orders.charge_lines jsonb null`: the split `chargesByRate` answered at
 *   placement, `[{ kind, rate, gross, net }]` as two-place decimal strings, so
 *   every document the order produces reads the split instead of recomputing
 *   it. Nothing writes it yet.
 * - `orders.vat_method` admits `per_rate_charges` (16 characters, the
 *   column's `varchar(16)`): an order placed with its charges taxed at the
 *   goods' rates. Nothing writes it yet either; placement still writes
 *   `per_rate`, with the charges at 0 %.
 *
 * Nullable, no backfill: an order placed before the switch keeps its charges at
 * 0 % on every document it will ever produce, because that is what it charged.
 *
 * `down` restores the one-value constraint and fails if a row already holds
 * `per_rate_charges`; it exists for a development rollback.
 */
export class Migration20261108T073238OrdersChargeLines extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "orders" add column if not exists "charge_lines" jsonb null;');
    this.addSql('alter table "orders" drop constraint if exists "orders_vat_method_check";');
    this.addSql(
      `alter table "orders" add constraint "orders_vat_method_check" check ("vat_method" is null or "vat_method" in ('per_rate', 'per_rate_charges'));`,
    );
  }

  override async down(): Promise<void> {
    this.addSql('alter table "orders" drop constraint if exists "orders_vat_method_check";');
    this.addSql(
      `alter table "orders" add constraint "orders_vat_method_check" check ("vat_method" is null or "vat_method" in ('per_rate'));`,
    );
    this.addSql('alter table "orders" drop column if exists "charge_lines";');
  }
}
