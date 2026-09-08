import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 119 — `invoice_ledger` shared rails (init).
 *
 * Five tables per data-model.md. Infakt owns none. UUID invoice ids only:
 * no foreign key to `invoices` (locked ledger, switchable invoices).
 */
export class Migration20260908T125013InvoiceLedgerInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "invoice_ledger_activation_lock" (
        "id" uuid not null,
        "active_module_id" varchar(64) null,
        "updated_at" timestamptz not null,
        "updated_by_admin_id" uuid null,
        constraint "invoice_ledger_activation_lock_pkey" primary key ("id"),
        constraint "invoice_ledger_activation_lock_id_ck"
          check ("id" = '00000000-0000-4000-8000-000000000001')
      );
    `);
    this.addSql(`
      alter table "invoice_ledger_activation_lock"
        add constraint "invoice_ledger_activation_lock_updated_by_admin_id_foreign"
        foreign key ("updated_by_admin_id") references "admin_users" ("id")
        on update cascade on delete set null;
    `);

    this.addSql(`
      create table "invoice_ledger_client_maps" (
        "id" uuid not null,
        "adapter_id" varchar(64) not null,
        "organization_id" uuid not null,
        "nip_used" varchar(32) not null,
        "remote_client_id" varchar(64) not null,
        "sales_channel_id" uuid null,
        "credential_code" varchar(128) not null,
        "environment" varchar(16) not null,
        "updated_at" timestamptz not null,
        constraint "invoice_ledger_client_maps_pkey" primary key ("id"),
        constraint "invoice_ledger_client_maps_environment_ck"
          check ("environment" in ('sandbox', 'production')),
        constraint "invoice_ledger_client_maps_adapter_org_env_cred_uq"
          unique ("adapter_id", "organization_id", "environment", "credential_code")
      );
    `);
    this.addSql(
      `create index "invoice_ledger_client_maps_organization_id_idx" on "invoice_ledger_client_maps" ("organization_id");`,
    );
    this.addSql(`
      alter table "invoice_ledger_client_maps"
        add constraint "invoice_ledger_client_maps_organization_id_foreign"
        foreign key ("organization_id") references "organizations" ("id")
        on update cascade;
    `);
    this.addSql(`
      alter table "invoice_ledger_client_maps"
        add constraint "invoice_ledger_client_maps_sales_channel_id_foreign"
        foreign key ("sales_channel_id") references "sales_channels" ("id")
        on update cascade on delete set null;
    `);

    this.addSql(`
      create table "invoice_ledger_document_maps" (
        "id" uuid not null,
        "adapter_id" varchar(64) not null,
        "invoice_id" uuid not null,
        "original_invoice_id" uuid null,
        "remote_document_id" varchar(64) null,
        "environment" varchar(16) not null,
        "credential_code" varchar(128) not null,
        "created_at" timestamptz not null,
        constraint "invoice_ledger_document_maps_pkey" primary key ("id"),
        constraint "invoice_ledger_document_maps_environment_ck"
          check ("environment" in ('sandbox', 'production')),
        constraint "invoice_ledger_document_maps_adapter_invoice_uq"
          unique ("adapter_id", "invoice_id")
      );
    `);
    this.addSql(
      `create index "invoice_ledger_document_maps_original_invoice_id_idx" on "invoice_ledger_document_maps" ("original_invoice_id");`,
    );
    this.addSql(`
      create unique index "invoice_ledger_document_maps_remote_cred_uq"
        on "invoice_ledger_document_maps" ("adapter_id", "remote_document_id", "environment", "credential_code")
        where "remote_document_id" is not null;
    `);

    this.addSql(`
      create table "invoice_ledger_deliveries" (
        "id" uuid not null,
        "adapter_id" varchar(64) not null,
        "invoice_id" uuid not null,
        "kind" varchar(16) not null,
        "sales_channel_id" uuid null,
        "credential_code" varchar(128) not null,
        "environment" varchar(16) not null,
        "numbering_mode" varchar(16) not null,
        "ksef_routing" varchar(16) not null,
        "status" varchar(24) not null,
        "async_task_id" varchar(128) null,
        "remote_document_id" varchar(64) null,
        "idempotency_key" varchar(128) not null,
        "attempt_count" int not null default 0,
        "attempts" jsonb not null default '[]',
        "last_error" text null,
        "remote_paid_at" timestamptz null,
        "ksef_delegated" boolean not null default false,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "invoice_ledger_deliveries_pkey" primary key ("id"),
        constraint "invoice_ledger_deliveries_kind_ck"
          check ("kind" in ('invoice', 'correction')),
        constraint "invoice_ledger_deliveries_environment_ck"
          check ("environment" in ('sandbox', 'production')),
        constraint "invoice_ledger_deliveries_numbering_mode_ck"
          check ("numbering_mode" in ('endora', 'vendor')),
        constraint "invoice_ledger_deliveries_ksef_routing_ck"
          check ("ksef_routing" in ('native', 'vendor')),
        constraint "invoice_ledger_deliveries_status_ck"
          check ("status" in ('queued', 'awaiting_remote', 'succeeded', 'failed', 'dead')),
        constraint "invoice_ledger_deliveries_attempt_count_ck"
          check ("attempt_count" >= 0),
        constraint "invoice_ledger_deliveries_adapter_invoice_uq"
          unique ("adapter_id", "invoice_id"),
        constraint "invoice_ledger_deliveries_adapter_idempotency_uq"
          unique ("adapter_id", "idempotency_key")
      );
    `);
    this.addSql(
      `create index "invoice_ledger_deliveries_status_idx" on "invoice_ledger_deliveries" ("status");`,
    );
    this.addSql(`
      create index "invoice_ledger_deliveries_remote_document_idx"
        on "invoice_ledger_deliveries" ("adapter_id", "remote_document_id")
        where "remote_document_id" is not null;
    `);
    this.addSql(`
      create unique index "invoice_ledger_deliveries_async_task_uq"
        on "invoice_ledger_deliveries" ("adapter_id", "async_task_id")
        where "async_task_id" is not null;
    `);
    this.addSql(`
      alter table "invoice_ledger_deliveries"
        add constraint "invoice_ledger_deliveries_sales_channel_id_foreign"
        foreign key ("sales_channel_id") references "sales_channels" ("id")
        on update cascade on delete set null;
    `);

    this.addSql(`
      create table "invoice_ledger_webhook_receipts" (
        "id" uuid not null,
        "adapter_id" varchar(64) not null,
        "event_id" varchar(128) not null,
        "event_type" varchar(64) not null,
        "state" varchar(24) not null,
        "attempts" int not null default 0,
        "received_at" timestamptz not null,
        "applied_at" timestamptz null,
        "error" text null,
        constraint "invoice_ledger_webhook_receipts_pkey" primary key ("id"),
        constraint "invoice_ledger_webhook_receipts_state_ck"
          check ("state" in ('received', 'processed', 'ignored', 'failed')),
        constraint "invoice_ledger_webhook_receipts_adapter_event_uq"
          unique ("adapter_id", "event_id")
      );
    `);
    this.addSql(
      `create index "invoice_ledger_webhook_receipts_state_idx" on "invoice_ledger_webhook_receipts" ("state");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "invoice_ledger_webhook_receipts" cascade;`);
    this.addSql(`drop table if exists "invoice_ledger_deliveries" cascade;`);
    this.addSql(`drop table if exists "invoice_ledger_document_maps" cascade;`);
    this.addSql(`drop table if exists "invoice_ledger_client_maps" cascade;`);
    this.addSql(`drop table if exists "invoice_ledger_activation_lock" cascade;`);
  }
}
