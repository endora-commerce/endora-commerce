import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 119, Phase 14a — ERP-imported sale documents (FR-087/FR-088).
 *
 * Extends `invoices` with origin/organization/external-ref columns and adds
 * `invoice_external_attachments` for lazy-fetched XL attachment metadata.
 */
export class Migration20260914T133603InvoicesErpImportedSaleDocuments extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "invoices" alter column "order_id" drop not null;`);

    this.addSql(
      `alter table "invoices" add column "origin" varchar(16) not null default 'platform';`,
    );
    this.addSql(`alter table "invoices" add column "organization_id" uuid null;`);
    this.addSql(`alter table "invoices" add column "external_document_ref" jsonb null;`);

    this.addSql(`create index "invoices_origin_index" on "invoices" ("origin");`);
    this.addSql(
      `create index "invoices_organization_id_index" on "invoices" ("organization_id");`,
    );

    this.addSql(`
      alter table "invoices"
      add constraint "invoices_organization_id_foreign"
      foreign key ("organization_id") references "organizations" ("id")
      on update cascade on delete restrict;
    `);

    this.addSql(`
      alter table "invoices"
      add constraint "invoices_origin_platform_order_chk"
      check (origin <> 'platform' or "order_id" is not null);
    `);
    this.addSql(`
      alter table "invoices"
      add constraint "invoices_origin_erp_import_org_chk"
      check (
        origin <> 'erp_import'
        or ("organization_id" is not null and "external_document_ref" is not null)
      );
    `);

    this.addSql(`
      create unique index "invoices_external_xl_sale_document_uq"
      on "invoices" ((external_document_ref->>'xlSaleDocumentId'))
      where origin = 'erp_import';
    `);

    this.addSql(`
      create table "invoice_external_attachments" (
        "id" uuid not null,
        "invoice_id" uuid not null,
        "xl_attachment_id" varchar(128) not null,
        "file_name" varchar(256) not null,
        "content_type" varchar(128) null,
        "asset_id" uuid null,
        "downloaded_at" timestamptz null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "invoice_external_attachments_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `create index "invoice_external_attachments_invoice_idx" on "invoice_external_attachments" ("invoice_id");`,
    );
    this.addSql(`
      alter table "invoice_external_attachments"
      add constraint "invoice_external_attachments_invoice_id_foreign"
      foreign key ("invoice_id") references "invoices" ("id")
      on update cascade on delete cascade;
    `);
    this.addSql(`
      alter table "invoice_external_attachments"
      add constraint "invoice_external_attachments_asset_id_foreign"
      foreign key ("asset_id") references "assets" ("id")
      on update cascade on delete set null;
    `);
    this.addSql(`
      alter table "invoice_external_attachments"
      add constraint "invoice_external_attachments_invoice_xl_uq"
      unique ("invoice_id", "xl_attachment_id");
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "invoice_external_attachments" cascade;`);

    this.addSql(`drop index if exists "invoices_external_xl_sale_document_uq";`);
    this.addSql(`alter table "invoices" drop constraint if exists "invoices_origin_erp_import_org_chk";`);
    this.addSql(`alter table "invoices" drop constraint if exists "invoices_origin_platform_order_chk";`);
    this.addSql(`alter table "invoices" drop constraint if exists "invoices_organization_id_foreign";`);
    this.addSql(`drop index if exists "invoices_organization_id_index";`);
    this.addSql(`drop index if exists "invoices_origin_index";`);
    this.addSql(`alter table "invoices" drop column if exists "external_document_ref";`);
    this.addSql(`alter table "invoices" drop column if exists "organization_id";`);
    this.addSql(`alter table "invoices" drop column if exists "origin";`);

    this.addSql(`alter table "invoices" alter column "order_id" set not null;`);
  }
}
