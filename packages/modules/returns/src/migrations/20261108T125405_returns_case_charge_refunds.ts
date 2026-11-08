import { Migration } from '@mikro-orm/migrations';

/**
 * Issue #876 — what a return case refunds of the order's delivery cost and of
 * its payment surcharge: a consumer's withdrawal from the whole sale refunds
 * both (Directive 2011/83 art. 13(1)) on the case that completes it. The default
 * and the approved amount of each, `0.00` by default.
 *
 * Additive, with no backfill: a case settled before refunded neither charge,
 * and that is what `0.00` records. Settled cases are not rewritten (owner ruling
 * E4 of 2026-11-07: no automatic remediation).
 */
export class Migration20261108T125405ReturnsCaseChargeRefunds extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table "return_cases" ' +
        'add column if not exists "default_delivery_refund" numeric(14,2) not null default 0, ' +
        'add column if not exists "approved_delivery_refund" numeric(14,2) not null default 0, ' +
        'add column if not exists "default_surcharge_refund" numeric(14,2) not null default 0, ' +
        'add column if not exists "approved_surcharge_refund" numeric(14,2) not null default 0;',
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      'alter table "return_cases" ' +
        'drop column if exists "default_delivery_refund", ' +
        'drop column if exists "approved_delivery_refund", ' +
        'drop column if exists "default_surcharge_refund", ' +
        'drop column if exists "approved_surcharge_refund";',
    );
  }
}
