import { Migration } from '@mikro-orm/migrations';

/**
 * Payment-method adapter framework (feature 034 — Metoda Płatności).
 *
 * Extends the existing `payment_methods` entry into a configurable,
 * adapter-backed payment method and the `payments` row into a richer
 * payment-process record:
 *
 *   payment_methods:
 *     + adapter            — registry key of the adapter realising the logic
 *                            (backfilled from the existing `kind`)
 *     + additional_price   — flat surcharge in the order currency
 *     + status_on_pending  — Order-status reference applied at order creation
 *     + status_on_success  — Order-status reference applied on a successful payment
 *     + status_on_failure  — Order-status reference applied on a failed payment
 *
 *   payments:
 *     + provider_details   — adapter/PSP payload captured on receive_payment
 *     + failure_reason     — populated on a failure outcome
 *     + attempt_no         — retry sequence per order (1 = first attempt)
 *
 * `status` columns stay plain varchar (no CHECK constraint existed), so the
 * new `failed` payment-process status needs no DDL beyond application code.
 * Seed status mappings reuse the current hard-coded order `status` enum
 * (new / confirmed / cancelled) until the Orders module ships a configurable
 * order-status registry (see research.md R2).
 */
export class Migration051PaymentMethodsAdapter extends Migration {
  override async up(): Promise<void> {
    // payment_methods — add nullable, backfill, then tighten to NOT NULL.
    this.addSql(`
      alter table "payment_methods"
        add column "adapter" varchar(64) null,
        add column "additional_price" numeric(14,2) not null default 0,
        add column "status_on_pending" varchar(64) null,
        add column "status_on_success" varchar(64) null,
        add column "status_on_failure" varchar(64) null;
    `);
    // Backfill: adapter mirrors the existing kind; statuses get seed defaults.
    this.addSql(`update "payment_methods" set "adapter" = "kind" where "adapter" is null;`);
    this.addSql(`update "payment_methods" set "status_on_pending" = 'new' where "status_on_pending" is null;`);
    this.addSql(`update "payment_methods" set "status_on_success" = 'confirmed' where "status_on_success" is null;`);
    this.addSql(`update "payment_methods" set "status_on_failure" = 'cancelled' where "status_on_failure" is null;`);
    this.addSql(`
      alter table "payment_methods"
        alter column "adapter" set not null,
        alter column "status_on_pending" set not null,
        alter column "status_on_success" set not null,
        alter column "status_on_failure" set not null;
    `);

    // payments — payment-process detail + retry sequence.
    this.addSql(`
      alter table "payments"
        add column "provider_details" jsonb null,
        add column "failure_reason" text null,
        add column "attempt_no" int not null default 1;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      alter table "payments"
        drop column if exists "provider_details",
        drop column if exists "failure_reason",
        drop column if exists "attempt_no";
    `);
    this.addSql(`
      alter table "payment_methods"
        drop column if exists "adapter",
        drop column if exists "additional_price",
        drop column if exists "status_on_pending",
        drop column if exists "status_on_success",
        drop column if exists "status_on_failure";
    `);
  }
}
