import { Migration } from '@mikro-orm/migrations';

/**
 * `payments.provider_details`, `failure_reason` and `attempt_no` — the
 * payment-process columns the `Payment` entity maps (`providerDetails`,
 * `failureReason`, `attemptNo`), created by the module that maps them.
 *
 * Until issue #611 the only migration creating them was `payment_methods`'
 * frozen `Migration20260611T140353PaymentMethodsAdapter` (feature 034), so
 * another module's migration decided this module's schema — the write the
 * migration table-ownership rule (feature 097, R2) refuses. Declaring
 * `payments` in `payment_methods` was no remedy: this module declares
 * `payment_methods`, so that closes a cycle. The frozen migration keeps its
 * class name and lost only these statements, the shape D-226 gave the
 * `cms_pages` index and feature 134 gave `refunded_amount`
 * (`Migration20260925T115728PaymentsRefundedAmount`).
 *
 * **`if not exists`**, because the columns are already present on every
 * database that ran the frozen migration, and there this must be a no-op that
 * keeps every value. Types, nullability and the default are the frozen
 * statement verbatim, so the two paths reach one schema.
 *
 * **`down()` is deliberately empty**, for `20260925T115728`'s reason: the
 * `payments` table is created by the platform's frozen `core_commerce_init`,
 * which a hard uninstall of this module never reverts, so its rows outlive this
 * module, and dropping the columns would lose every surviving payment's
 * provider payload, failure reason and attempt number.
 */
export class Migration20261114T001851PaymentsProcessColumns extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "payments"
        add column if not exists "provider_details" jsonb null,
        add column if not exists "failure_reason" text null,
        add column if not exists "attempt_no" int not null default 1;
    `);
  }

  override async down(): Promise<void> {
    // Intentionally empty — see the class comment.
  }
}
