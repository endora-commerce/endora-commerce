import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 047 — Invoices module.
 *
 * Extends the existing `invoices` table (created in 004_commerce_init) with the
 * fields needed for real VAT invoices, and adds the supporting tables:
 *   - `invoice_lines`            — immutable per-line snapshots
 *   - `invoice_number_counters`  — per (channel, kind, year) gap-free sequence
 *   - `invoice_templates`        — WYSIWYG (Puck) PDF layouts (global + per-channel)
 *
 * No email-log table — invoice emails reuse the `transactional_emails` module.
 */
export class Migration20260629T125121InvoicesModule extends Migration {
  override async up(): Promise<void> {
    // --- Extend invoices ---------------------------------------------------
    this.addSql(`alter table "invoices" add column "sales_channel_id" uuid null;`);
    this.addSql(`alter table "invoices" add column "sale_date" date null;`);
    this.addSql(`alter table "invoices" add column "payment_due_date" date null;`);
    this.addSql(`alter table "invoices" add column "payment_method" varchar(64) null;`);
    this.addSql(`alter table "invoices" add column "net_total" numeric(14,2) null;`);
    this.addSql(`alter table "invoices" add column "tax_total" numeric(14,2) null;`);
    this.addSql(`alter table "invoices" add column "paid_total" numeric(14,2) not null default 0;`);
    this.addSql(`alter table "invoices" add column "original_invoice_id" uuid null;`);
    this.addSql(`alter table "invoices" add column "template_id" uuid null;`);
    this.addSql(`alter table "invoices" add column "seller_snapshot" jsonb null;`);
    this.addSql(`alter table "invoices" add column "buyer_snapshot" jsonb null;`);
    this.addSql(`alter table "invoices" add column "ksef_reference_number" varchar(128) null;`);
    this.addSql(`alter table "invoices" add column "ksef_processed_at" timestamptz null;`);
    this.addSql(`alter table "invoices" add column "issued_by" varchar(128) null;`);
    this.addSql(`create index "invoices_sales_channel_id_index" on "invoices" ("sales_channel_id");`);
    this.addSql(`create index "invoices_kind_index" on "invoices" ("kind");`);
    // At most one invoice + one proforma per order; many corrections allowed.
    this.addSql(
      `create unique index "invoices_order_kind_uq" on "invoices" ("order_id", "kind") where "kind" <> 'correction';`,
    );

    // --- invoice_lines -----------------------------------------------------
    this.addSql(`
      create table "invoice_lines" (
        "id" uuid not null,
        "invoice_id" uuid not null,
        "ordinal" int not null,
        "name" varchar(512) not null,
        "unit" varchar(32) not null,
        "quantity" numeric(12,3) not null,
        "unit_net_price" numeric(14,4) not null,
        "tax_rate" numeric(5,4) not null,
        "net_value" numeric(14,2) not null,
        "gross_value" numeric(14,2) not null,
        "order_item_id" uuid null,
        constraint "invoice_lines_pkey" primary key ("id")
      );
    `);
    this.addSql(`create index "invoice_lines_invoice_idx" on "invoice_lines" ("invoice_id");`);
    this.addSql(
      `create index "invoice_lines_invoice_ordinal_idx" on "invoice_lines" ("invoice_id", "ordinal");`,
    );

    // --- invoice_number_counters ------------------------------------------
    this.addSql(`
      create table "invoice_number_counters" (
        "id" uuid not null,
        "sales_channel_id" uuid not null,
        "kind" varchar(16) not null,
        "period_year" int not null,
        "current_value" int not null default 0,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "invoice_number_counters_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `alter table "invoice_number_counters" add constraint "invoice_number_counters_scope_uq" unique ("sales_channel_id", "kind", "period_year");`,
    );

    // --- invoice_templates -------------------------------------------------
    this.addSql(`
      create table "invoice_templates" (
        "id" uuid not null,
        "code" varchar(180) not null,
        "name" varchar(200) not null,
        "sales_channel_id" uuid null,
        "content" jsonb not null,
        "languages" jsonb not null,
        "active" boolean not null default true,
        "is_system" boolean not null default false,
        "version" int not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "invoice_templates_pkey" primary key ("id")
      );
    `);
    this.addSql(`create index "invoice_templates_code_idx" on "invoice_templates" ("code");`);
    this.addSql(
      `create index "invoice_templates_sales_channel_idx" on "invoice_templates" ("sales_channel_id");`,
    );
    // One active template per channel (global = the all-zero coalesce key).
    this.addSql(
      `create unique index "invoice_templates_active_scope_uq" on "invoice_templates" ` +
        `(coalesce("sales_channel_id", '00000000-0000-0000-0000-000000000000')) where "active";`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "invoice_templates";`);
    this.addSql(`drop table if exists "invoice_number_counters";`);
    this.addSql(`drop table if exists "invoice_lines";`);
    this.addSql(`drop index if exists "invoices_order_kind_uq";`);
    this.addSql(`drop index if exists "invoices_kind_index";`);
    this.addSql(`drop index if exists "invoices_sales_channel_id_index";`);
    for (const col of [
      'issued_by',
      'ksef_processed_at',
      'ksef_reference_number',
      'buyer_snapshot',
      'seller_snapshot',
      'template_id',
      'original_invoice_id',
      'paid_total',
      'tax_total',
      'net_total',
      'payment_method',
      'payment_due_date',
      'sale_date',
      'sales_channel_id',
    ]) {
      this.addSql(`alter table "invoices" drop column if exists "${col}";`);
    }
  }
}
