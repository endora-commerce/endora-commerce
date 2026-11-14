import { Migration } from '@mikro-orm/migrations';

/**
 * Payment-method adapter framework (feature 034 — Metoda Płatności).
 *
 * Extends the existing `payment_methods` entry into a configurable,
 * adapter-backed payment method:
 *
 *   payment_methods:
 *     + adapter            — registry key of the adapter realising the logic
 *                            (backfilled from the existing `kind`)
 *     + additional_price   — flat surcharge in the order currency
 *     + status_on_pending  — Order-status reference applied at order creation
 *     + status_on_success  — Order-status reference applied on a successful payment
 *     + status_on_failure  — Order-status reference applied on a failed payment
 *
 * It also widened `payments` with `provider_details`, `failure_reason` and
 * `attempt_no` until issue #611. Those columns are `payments`' — its
 * `Payment` entity maps them — and `payments` declares this module, so the
 * statement moved to `Migration20261114T001851PaymentsProcessColumns`,
 * verbatim and `if not exists`, in the shape D-226 gave the `cms_pages` index
 * `assets_library`'s frozen init carried. This class keeps its name, so a
 * database that has applied it is not offered it again, and its schema is
 * unchanged.
 *
 * `status` columns stay plain varchar (no CHECK constraint existed), so the
 * new `failed` payment-process status needs no DDL beyond application code.
 * Seed status mappings reuse the current hard-coded order `status` enum
 * (new / confirmed / cancelled) until the Orders module ships a configurable
 * order-status registry (see research.md R2).
 */
export class Migration20260611T140353PaymentMethodsAdapter extends Migration {
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
    this.addSql(`update "payment_methods" set "status_on_success" = 'paid' where "status_on_success" is null;`);
    this.addSql(`update "payment_methods" set "status_on_failure" = 'cancelled' where "status_on_failure" is null;`);
    this.addSql(`
      alter table "payment_methods"
        alter column "adapter" set not null,
        alter column "status_on_pending" set not null,
        alter column "status_on_success" set not null,
        alter column "status_on_failure" set not null;
    `);
  }

  override async down(): Promise<void> {
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
