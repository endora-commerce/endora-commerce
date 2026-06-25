import { Migration } from '@mikro-orm/migrations';
import { randomUUID } from 'crypto';
import {
  DEFAULT_RETURN_STATUSES,
  computeDefaultTransitions,
} from '../domain/return-status-graph.js';

/**
 * Feature 046 — Returns & Complaints (Refunds, RMA).
 *
 * Creates the returns module schema: the RMA case + items, the configurable
 * status graph (`return_statuses` + `return_status_transitions`) seeded from the
 * single source of truth in `domain/return-status-graph.ts`, comments, managed
 * reasons (seeded with defaults), return delivery methods, refunds, return
 * shipments, attachments, saved views, and the `return_cases_rma_seq` sequence.
 */
export class Migration080ReturnsInit extends Migration {
  override async up(): Promise<void> {
    // --- Configurable status graph -----------------------------------------
    this.addSql(`
      create table "return_statuses" (
        "id" uuid not null,
        "code" varchar(64) not null,
        "name" jsonb not null,
        "default_name" varchar(120) not null,
        "is_initial" boolean not null default false,
        "is_terminal" boolean not null default false,
        "is_system" boolean not null default false,
        "weight" int not null default 100,
        "color" varchar(16) not null default '#64748b',
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "return_statuses_pkey" primary key ("id")
      );
    `);
    this.addSql(`alter table "return_statuses" add constraint "return_statuses_code_unique" unique ("code");`);

    this.addSql(`
      create table "return_status_transitions" (
        "id" uuid not null,
        "from_status_code" varchar(64) not null,
        "to_status_code" varchar(64) not null,
        "is_system" boolean not null default false,
        "created_at" timestamptz not null,
        constraint "return_status_transitions_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `alter table "return_status_transitions" add constraint "return_status_transitions_pair_unique" unique ("from_status_code", "to_status_code");`,
    );
    this.addSql(
      `create index "return_status_transitions_from_idx" on "return_status_transitions" ("from_status_code");`,
    );

    for (const s of DEFAULT_RETURN_STATUSES) {
      this.addSql(
        `insert into "return_statuses" ("id", "code", "name", "default_name", "is_initial", "is_terminal", "is_system", "weight", "color", "created_at", "updated_at") ` +
          `values ('${randomUUID()}', '${s.code}', '${jsonLiteral(s.name)}'::jsonb, '${s.defaultName}', ${s.isInitial}, ${s.isTerminal}, ${s.isSystem}, ${s.weight}, '${s.color}', now(), now());`,
      );
    }
    for (const t of computeDefaultTransitions()) {
      this.addSql(
        `insert into "return_status_transitions" ("id", "from_status_code", "to_status_code", "is_system", "created_at") ` +
          `values ('${randomUUID()}', '${t.fromStatusCode}', '${t.toStatusCode}', ${t.isSystem}, now());`,
      );
    }

    // --- RMA case number sequence ------------------------------------------
    this.addSql(`create sequence if not exists "return_cases_rma_seq";`);

    // --- Cases & items ------------------------------------------------------
    this.addSql(`
      create table "return_cases" (
        "id" uuid not null,
        "kind" varchar(16) not null,
        "rma_number" varchar(64) null,
        "order_id" uuid not null,
        "sales_channel_id" uuid not null,
        "customer_account_id" uuid not null,
        "organization_id" uuid null,
        "status_code" varchar(64) not null,
        "currency" varchar(3) not null,
        "return_delivery_method_id" uuid null,
        "applied_return_cost" numeric(14,2) not null default 0,
        "return_cost_bearer" varchar(16) not null default 'customer',
        "free_return_eligible" boolean not null default false,
        "resolution_type" varchar(16) null,
        "refund_payment_method_id" uuid null,
        "total_refund_amount" numeric(14,2) not null default 0,
        "rejection_reason" text null,
        "submitted_at" timestamptz not null,
        "authorized_at" timestamptz null,
        "resolved_at" timestamptz null,
        "closed_at" timestamptz null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "return_cases_pkey" primary key ("id")
      );
    `);
    this.addSql(`alter table "return_cases" add constraint "return_cases_rma_number_unique" unique ("rma_number");`);
    this.addSql(`create index "return_cases_order_idx" on "return_cases" ("order_id");`);
    this.addSql(`create index "return_cases_sales_channel_idx" on "return_cases" ("sales_channel_id");`);
    this.addSql(`create index "return_cases_customer_idx" on "return_cases" ("customer_account_id");`);
    this.addSql(`create index "return_cases_organization_idx" on "return_cases" ("organization_id");`);
    this.addSql(`create index "return_cases_status_idx" on "return_cases" ("status_code");`);

    this.addSql(`
      create table "return_case_items" (
        "id" uuid not null,
        "return_case_id" uuid not null,
        "order_item_id" uuid not null,
        "product_id" uuid not null,
        "product_name" varchar(512) not null,
        "quantity" int not null,
        "reason_id" uuid null,
        "description" text null,
        "inspection_outcome" varchar(16) null,
        "default_refund_amount" numeric(14,2) not null,
        "approved_refund_amount" numeric(14,2) not null default 0,
        constraint "return_case_items_pkey" primary key ("id")
      );
    `);
    this.addSql(`create index "return_case_items_case_idx" on "return_case_items" ("return_case_id");`);
    this.addSql(`create index "return_case_items_order_item_idx" on "return_case_items" ("order_item_id");`);

    // --- Comments -----------------------------------------------------------
    this.addSql(`
      create table "return_case_comments" (
        "id" uuid not null,
        "return_case_id" uuid not null,
        "author_admin_user_id" uuid null,
        "author_customer_account_id" uuid null,
        "body" text not null,
        "is_customer_visible" boolean not null default true,
        "notify_customer" boolean not null default false,
        "created_at" timestamptz not null,
        constraint "return_case_comments_pkey" primary key ("id")
      );
    `);
    this.addSql(`create index "return_case_comments_case_idx" on "return_case_comments" ("return_case_id");`);
    this.addSql(`create index "return_case_comments_created_idx" on "return_case_comments" ("created_at");`);

    // --- Reasons (seeded with defaults) ------------------------------------
    this.addSql(`
      create table "return_reasons" (
        "id" uuid not null,
        "label" jsonb not null,
        "applies_to" varchar(16) not null,
        "is_active" boolean not null default true,
        "weight" int not null default 100,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "return_reasons_pkey" primary key ("id")
      );
    `);
    for (const r of DEFAULT_RETURN_REASONS) {
      this.addSql(
        `insert into "return_reasons" ("id", "label", "applies_to", "is_active", "weight", "created_at", "updated_at") ` +
          `values ('${randomUUID()}', '${jsonLiteral(r.label)}'::jsonb, '${r.appliesTo}', true, ${r.weight}, now(), now());`,
      );
    }

    // --- Return delivery methods -------------------------------------------
    this.addSql(`
      create table "return_delivery_methods" (
        "id" uuid not null,
        "delivery_method_id" uuid not null,
        "return_cost" numeric(14,2) not null,
        "currency" varchar(3) not null,
        "is_active" boolean not null default true,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "return_delivery_methods_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `create index "return_delivery_methods_method_idx" on "return_delivery_methods" ("delivery_method_id");`,
    );

    // --- Refunds ------------------------------------------------------------
    this.addSql(`
      create table "refunds" (
        "id" uuid not null,
        "return_case_id" uuid not null,
        "resolution_type" varchar(16) not null,
        "amount" numeric(14,2) not null,
        "currency" varchar(3) not null,
        "payment_method_id" uuid null,
        "settlement_state" varchar(16) not null,
        "external_reference" varchar(128) null,
        "provider_details" jsonb null,
        "failure_reason" text null,
        "corrective_invoice_id" uuid null,
        "credit_limit_topup_applied" boolean not null default false,
        "attempt_no" int not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "refunds_pkey" primary key ("id")
      );
    `);
    this.addSql(`create index "refunds_case_idx" on "refunds" ("return_case_id");`);

    // --- Return shipments ---------------------------------------------------
    this.addSql(`
      create table "return_shipments" (
        "id" uuid not null,
        "return_case_id" uuid not null,
        "direction" varchar(16) not null,
        "delivery_method_id" uuid null,
        "external_reference" varchar(128) null,
        "status" varchar(16) not null default 'pending',
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "return_shipments_pkey" primary key ("id")
      );
    `);
    this.addSql(`create index "return_shipments_case_idx" on "return_shipments" ("return_case_id");`);

    // --- Attachments --------------------------------------------------------
    this.addSql(`
      create table "return_case_attachments" (
        "id" uuid not null,
        "return_case_id" uuid not null,
        "return_case_item_id" uuid null,
        "asset_id" uuid not null,
        "created_at" timestamptz not null,
        constraint "return_case_attachments_pkey" primary key ("id")
      );
    `);
    this.addSql(`create index "return_case_attachments_case_idx" on "return_case_attachments" ("return_case_id");`);

    // --- Saved views --------------------------------------------------------
    this.addSql(`
      create table "return_list_saved_views" (
        "id" uuid not null,
        "owner_admin_user_id" uuid not null,
        "name" varchar(200) not null,
        "shared" boolean not null default false,
        "filters" jsonb not null,
        "sort" jsonb not null,
        "visible_columns" jsonb null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "return_list_saved_views_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `create index "return_list_saved_views_owner_idx" on "return_list_saved_views" ("owner_admin_user_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "return_list_saved_views";`);
    this.addSql(`drop table if exists "return_case_attachments";`);
    this.addSql(`drop table if exists "return_shipments";`);
    this.addSql(`drop table if exists "refunds";`);
    this.addSql(`drop table if exists "return_delivery_methods";`);
    this.addSql(`drop table if exists "return_reasons";`);
    this.addSql(`drop table if exists "return_case_comments";`);
    this.addSql(`drop table if exists "return_case_items";`);
    this.addSql(`drop table if exists "return_cases";`);
    this.addSql(`drop sequence if exists "return_cases_rma_seq";`);
    this.addSql(`drop table if exists "return_status_transitions";`);
    this.addSql(`drop table if exists "return_statuses";`);
  }
}

/** Default reasons seeded on install (FR-030; B2B examples from the spec). */
const DEFAULT_RETURN_REASONS: ReadonlyArray<{ label: Record<string, string>; appliesTo: 'return' | 'complaint' | 'both'; weight: number }> = [
  { label: { en: 'Overstock / surplus', pl: 'Nadwyżka magazynowa' }, appliesTo: 'return', weight: 10 },
  { label: { en: 'Ordered by mistake', pl: 'Błędne zamówienie' }, appliesTo: 'return', weight: 20 },
  { label: { en: 'Changed mind', pl: 'Rezygnacja' }, appliesTo: 'return', weight: 30 },
  { label: { en: 'Damaged in transit', pl: 'Uszkodzone w transporcie' }, appliesTo: 'complaint', weight: 40 },
  { label: { en: 'Factory defect', pl: 'Wada fabryczna' }, appliesTo: 'complaint', weight: 50 },
  { label: { en: 'Wrong item delivered', pl: 'Dostarczono niewłaściwy produkt' }, appliesTo: 'both', weight: 60 },
];

/** Serialize a localized label map to a single-quoted SQL JSON literal. */
function jsonLiteral(value: Record<string, string>): string {
  return JSON.stringify(value).replace(/'/g, "''");
}
