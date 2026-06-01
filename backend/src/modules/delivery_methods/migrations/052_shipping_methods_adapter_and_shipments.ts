import { Migration } from '@mikro-orm/migrations';

/**
 * Shipping-method adapter framework + Shipment record (feature 035 — Metoda
 * Dostawy).
 *
 * Extends the existing `delivery_methods` entry into a configurable,
 * adapter-backed shipping method and introduces the `shipments` record:
 *
 *   delivery_methods:
 *     + adapter            — registry key of the ShippingAdapter realising the
 *                            logic (backfilled from the existing `code`)
 *     + status_on_success  — Order-status reference applied on a successful
 *                            shipment generation (seed `shipped`)
 *     + status_on_failure  — Order-status reference applied on a failed
 *                            shipment generation (seed `in_fulfilment`)
 *
 *   shipments (new):
 *     a first-class generation attempt against an Order — order_id,
 *     delivery_method_id, status (pending|success|failure), external_reference,
 *     provider_details, failure_reason, attempt_no, timestamps.
 *
 * `price` reuses the existing `delivery_methods.cost` column (no new column).
 * Seed status mappings reuse the current hard-coded order `status` enum until
 * the Orders module ships a configurable registry (see research.md R3/R10).
 */
export class Migration052ShippingMethodsAdapterAndShipments extends Migration {
  override async up(): Promise<void> {
    // delivery_methods — add nullable, backfill, then tighten to NOT NULL.
    // `adapter` carries a NOT NULL DEFAULT '' so that generic insert paths that
    // predate the framework (sales-channel/membership fixtures, legacy seeds)
    // keep working: a row with an empty adapter is simply not selectable — it
    // never resolves to a registered adapter (FR-003) — while adapter-backed
    // rows always set it explicitly.
    this.addSql(`
      alter table "delivery_methods"
        add column "adapter" varchar(64) not null default '',
        add column "status_on_success" varchar(64) not null default 'shipment_sent',
        add column "status_on_failure" varchar(64) not null default 'processing';
    `);
    // Backfill existing rows: adapter mirrors the existing code.
    this.addSql(`update "delivery_methods" set "adapter" = "code" where "adapter" = '';`);

    // shipments — first-class shipment-generation attempt record.
    this.addSql(`
      create table "shipments" (
        "id" uuid not null,
        "order_id" uuid not null,
        "delivery_method_id" uuid not null,
        "status" varchar(32) not null default 'pending',
        "external_reference" varchar(255) null,
        "provider_details" jsonb null,
        "failure_reason" text null,
        "attempt_no" int not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "shipments_pkey" primary key ("id"),
        constraint "shipments_status_check" check ("status" in ('pending', 'success', 'failure'))
      );
    `);
    this.addSql(`create index "shipments_order_id_index" on "shipments" ("order_id");`);
    this.addSql(`create index "shipments_status_index" on "shipments" ("status");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "shipments";`);
    this.addSql(`
      alter table "delivery_methods"
        drop column "adapter",
        drop column "status_on_success",
        drop column "status_on_failure";
    `);
  }
}
