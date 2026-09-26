import { Migration } from '@mikro-orm/migrations';

/**
 * `payments.refunded_amount` — the cumulative refunded amount the `Payment`
 * entity maps (`refundedAmount`), created by the module that maps it.
 *
 * Until feature 134 (feature 134, research D14) the
 * only migration creating this column was `stripe`'s
 * `Migration20260715T103358StripePaymentRefundedAmount`: an instance without
 * `stripe` could not insert a payment, and `stripe`'s hard uninstall dropped a
 * column this module reads and writes. That migration keeps its class name and
 * has both bodies emptied; this one replaces it.
 *
 * **`if not exists`**, because the column is already present on every database
 * that ran `stripe`'s migration, and there this must be a no-op that keeps
 * every value.
 *
 * **`down()` is deliberately empty.** The `payments` table is created by the
 * platform's frozen `core_commerce_init`, which a hard uninstall of this module
 * never reverts, so the table and its rows outlive this module. Dropping the
 * column would reset every surviving payment's refunded amount to zero on the
 * next install, and nothing would report it: a down that removes one column
 * from rows that survive is data loss, not a revert.
 */
export class Migration20260925T115728PaymentsRefundedAmount extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "payments" add column if not exists "refunded_amount" numeric(14,2) not null default '0';`,
    );
  }

  override async down(): Promise<void> {
    // Intentionally empty — see the class comment.
  }
}
