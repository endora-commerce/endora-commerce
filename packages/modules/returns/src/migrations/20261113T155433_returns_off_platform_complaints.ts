import { Migration } from '@mikro-orm/migrations';

/**
 * `specs/180-off-platform-complaints/` phase B (data-model §2.5): the complaint without
 * a platform order.
 *
 * 1. `return_cases` — `order_id` becomes nullable (`null` = off-platform, R5), with the
 *    purchase, contact, ship-back address, shown clauses, outside-settlement note,
 *    submission key and erasure stamp; checks hold R3 (no order ⇒ complaint), FR-B13
 *    (no order ⇒ a purchase date) and FR-B33a (`settled_outside` ⇒ no order and a note).
 * 2. `return_case_items` — `order_item_id` and `product_id` nullable, `serial_number`.
 * 3. `return_case_attachments` — reclassified as tenant-scoped: a pending upload has no
 *    case to inherit a tenant from, so the row carries `organization_id`, back-filled
 *    from its case. The column stays nullable on every database (owner ruling, 2026-11-16):
 *    a legacy row whose case has no organization cannot be given one (research R-12: such
 *    rows were never readable, and the tenant filter keeps them so), and a guest's file
 *    (`specs/181-guest-complaints/`) has none. A row without an organization matches no
 *    organization-scoped read, as `AnalyticsEvent`'s do (the platform's org write guard).
 * 4. `return_case_clauses` — new.
 *
 * It references no other module's table. `down` reverses it and refuses while a case
 * without a platform order exists: `order_id` cannot become `not null` again without
 * deleting it.
 */
export class Migration20261113T155433ReturnsOffPlatformComplaints extends Migration {
  override async up(): Promise<void> {
    // 1. Cases.
    this.addSql('alter table "return_cases" alter column "order_id" drop not null;');
    this.addSql(
      'alter table "return_cases" ' +
        'add column if not exists "purchase_proof_number" varchar(100) null, ' +
        'add column if not exists "purchase_date" date null, ' +
        'add column if not exists "contact" jsonb null, ' +
        'add column if not exists "return_address" jsonb null, ' +
        `add column if not exists "accepted_clauses" jsonb not null default '[]', ` +
        'add column if not exists "clauses_accepted_at" timestamptz null, ' +
        'add column if not exists "resolution_note" text null, ' +
        'add column if not exists "submission_key" uuid null, ' +
        'add column if not exists "personal_data_erased_at" timestamptz null;',
    );
    this.addSql('alter table "return_cases" drop constraint if exists "return_cases_off_platform_kind_check";');
    this.addSql(
      `alter table "return_cases" add constraint "return_cases_off_platform_kind_check" check ("order_id" is not null or "kind" = 'complaint');`,
    );
    this.addSql('alter table "return_cases" drop constraint if exists "return_cases_off_platform_purchase_date_check";');
    this.addSql(
      'alter table "return_cases" add constraint "return_cases_off_platform_purchase_date_check" check ("order_id" is not null or "purchase_date" is not null);',
    );
    this.addSql('alter table "return_cases" drop constraint if exists "return_cases_settled_outside_check";');
    this.addSql(
      `alter table "return_cases" add constraint "return_cases_settled_outside_check" check ("resolution_type" is null or "resolution_type" <> 'settled_outside' or ("order_id" is null and "resolution_note" is not null));`,
    );
    this.addSql(
      'create unique index if not exists "return_cases_submission_key_unique" on "return_cases" ("customer_account_id", "submission_key") where "submission_key" is not null;',
    );

    // 2. Lines.
    this.addSql(
      'alter table "return_case_items" ' +
        'alter column "order_item_id" drop not null, ' +
        'alter column "product_id" drop not null, ' +
        'add column if not exists "serial_number" varchar(100) null;',
    );
    this.addSql('alter table "return_case_items" drop constraint if exists "return_case_items_product_name_check";');
    // `not valid`: enforced for every row written from now on, without judging old rows.
    this.addSql(
      `alter table "return_case_items" add constraint "return_case_items_product_name_check" check ("product_name" <> '') not valid;`,
    );

    // 3. Attachments.
    this.addSql(
      'alter table "return_case_attachments" ' +
        'alter column "return_case_id" drop not null, ' +
        'alter column "asset_id" drop not null, ' +
        'add column if not exists "organization_id" uuid null, ' +
        'add column if not exists "customer_account_id" uuid null, ' +
        `add column if not exists "type" varchar(24) not null default 'other', ` +
        'add column if not exists "filename" varchar(255) null, ' +
        'add column if not exists "mime_type" varchar(64) null, ' +
        'add column if not exists "size_bytes" integer null, ' +
        'add column if not exists "storage_backend" varchar(32) null, ' +
        'add column if not exists "storage_locator" varchar(512) null, ' +
        'add column if not exists "expires_at" timestamptz null;',
    );
    this.addSql(`
      update "return_case_attachments" a
         set "organization_id" = rc."organization_id"
        from "return_cases" rc
       where rc."id" = a."return_case_id"
         and a."organization_id" is null;
    `);
    this.addSql('alter table "return_case_attachments" drop constraint if exists "return_case_attachments_stored_check";');
    this.addSql(
      'alter table "return_case_attachments" add constraint "return_case_attachments_stored_check" check ("asset_id" is not null or "storage_locator" is not null);',
    );
    this.addSql('alter table "return_case_attachments" drop constraint if exists "return_case_attachments_pending_check";');
    this.addSql(
      'alter table "return_case_attachments" add constraint "return_case_attachments_pending_check" check ("return_case_id" is not null or "expires_at" is not null);',
    );
    this.addSql(
      'create index if not exists "return_case_attachments_pending_expiry_idx" on "return_case_attachments" ("expires_at") where "return_case_id" is null;',
    );
    this.addSql(
      'create index if not exists "return_case_attachments_customer_idx" on "return_case_attachments" ("customer_account_id");',
    );
    this.addSql(
      'create index if not exists "return_case_attachments_organization_idx" on "return_case_attachments" ("organization_id");',
    );

    // 4. Clauses.
    this.addSql(`
      create table if not exists "return_case_clauses" (
        "id" uuid not null,
        "label" jsonb not null,
        "text" jsonb not null,
        "link_url" jsonb null,
        "applies_to" varchar(16) not null default 'both',
        "mode" varchar(16) not null default 'must_accept',
        "sales_channel_id" uuid null,
        "weight" integer not null default 100,
        "is_active" boolean not null default true,
        "revision" integer not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "return_case_clauses_pkey" primary key ("id"),
        constraint "return_case_clauses_applies_to_check" check ("applies_to" in ('return', 'complaint', 'both')),
        constraint "return_case_clauses_mode_check" check ("mode" in ('must_accept', 'inform_only'))
      );
    `);
    this.addSql(
      'create index if not exists "return_case_clauses_channel_idx" on "return_case_clauses" ("sales_channel_id");',
    );
  }

  override async down(): Promise<void> {
    this.addSql(`
      do $$
      begin
        if exists (select 1 from "return_cases" where "order_id" is null) then
          raise exception 'returns: cases without a platform order exist; the migration cannot be reversed without deleting them';
        end if;
      end $$;
    `);
    this.addSql('drop table if exists "return_case_clauses";');

    // Uploads exist only in the new shape; the old one cannot hold them.
    this.addSql('delete from "return_case_attachments" where "asset_id" is null or "return_case_id" is null;');
    this.addSql('drop index if exists "return_case_attachments_pending_expiry_idx";');
    this.addSql('drop index if exists "return_case_attachments_customer_idx";');
    this.addSql('drop index if exists "return_case_attachments_organization_idx";');
    this.addSql('alter table "return_case_attachments" drop constraint if exists "return_case_attachments_stored_check";');
    this.addSql('alter table "return_case_attachments" drop constraint if exists "return_case_attachments_pending_check";');
    this.addSql(
      'alter table "return_case_attachments" ' +
        'drop column if exists "organization_id", ' +
        'drop column if exists "customer_account_id", ' +
        'drop column if exists "type", ' +
        'drop column if exists "filename", ' +
        'drop column if exists "mime_type", ' +
        'drop column if exists "size_bytes", ' +
        'drop column if exists "storage_backend", ' +
        'drop column if exists "storage_locator", ' +
        'drop column if exists "expires_at", ' +
        'alter column "return_case_id" set not null, ' +
        'alter column "asset_id" set not null;',
    );

    this.addSql('alter table "return_case_items" drop constraint if exists "return_case_items_product_name_check";');
    this.addSql(
      'alter table "return_case_items" ' +
        'drop column if exists "serial_number", ' +
        'alter column "order_item_id" set not null, ' +
        'alter column "product_id" set not null;',
    );

    this.addSql('drop index if exists "return_cases_submission_key_unique";');
    this.addSql('alter table "return_cases" drop constraint if exists "return_cases_off_platform_kind_check";');
    this.addSql('alter table "return_cases" drop constraint if exists "return_cases_off_platform_purchase_date_check";');
    this.addSql('alter table "return_cases" drop constraint if exists "return_cases_settled_outside_check";');
    this.addSql(
      'alter table "return_cases" ' +
        'drop column if exists "purchase_proof_number", ' +
        'drop column if exists "purchase_date", ' +
        'drop column if exists "contact", ' +
        'drop column if exists "return_address", ' +
        'drop column if exists "accepted_clauses", ' +
        'drop column if exists "clauses_accepted_at", ' +
        'drop column if exists "resolution_note", ' +
        'drop column if exists "submission_key", ' +
        'drop column if exists "personal_data_erased_at", ' +
        'alter column "order_id" set not null;',
    );
  }
}
