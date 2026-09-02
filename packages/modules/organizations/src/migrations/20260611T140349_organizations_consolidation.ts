import { Migration } from '@mikro-orm/migrations';

/**
 * Organizations consolidation (feature 026).
 *
 * Extends the existing `organizations` table with the columns required by
 * the moderation lifecycle (approve/reject/block), VAT-validation tracking,
 * optimistic locking, and a denormalized `name_search` column used by the
 * admin OrganizationPicker (diacritic-insensitive prefix search without
 * needing the pg_trgm/unaccent extensions).
 *
 * Data migration: legacy `status='suspended'` rows are remapped to
 * `status='blocked'` with an explanatory `blocked_reason` so the audit trail
 * carries the breadcrumb.
 *
 * Introduces four new tables:
 *   - organization_tax_id_validations — one row per validation attempt.
 *   - organization_payment_methods    — per-org allow-list bridge.
 *   - organization_delivery_methods   — per-org allow-list bridge.
 *   - organization_warehouses         — per-org assignment bridge.
 */
export class Migration20260611T140349OrganizationsConsolidation extends Migration {
  override async up(): Promise<void> {
    // 1) New columns on `organizations`.
    this.addSql(`
      alter table "organizations"
        add column "legal_name" varchar(255) null,
        add column "vat_validated_at" timestamptz null,
        add column "vat_validation_provider" varchar(32) null,
        add column "vat_validation_outcome" varchar(16) null,
        add column "blocked_reason" text null,
        add column "blocked_at" timestamptz null,
        add column "rejected_reason" text null,
        add column "rejected_at" timestamptz null,
        add column "approved_at" timestamptz null,
        add column "approved_by_admin_user_id" uuid null,
        add column "name_search" varchar(255) not null default '',
        add column "version" int not null default 0;
    `);

    this.addSql(`
      alter table "organizations"
        add constraint "organizations_vat_validation_outcome_check"
        check ("vat_validation_outcome" is null
          or "vat_validation_outcome" in ('validated', 'failed', 'deferred', 'unverified'));
    `);

    this.addSql(`
      alter table "organizations"
        add constraint "organizations_approved_by_admin_user_fk"
        foreign key ("approved_by_admin_user_id")
        references "admin_users" ("id")
        on delete set null;
    `);

    // 2) Backfill `name_search` from existing `name` rows.
    //    Strips combining marks via PostgreSQL's `translate` for the most
    //    common diacritics present in the seed data. Subsequent writes go
    //    through the application's stripDiacritics() helper which handles
    //    every Unicode combining mark uniformly.
    this.addSql(`
      update "organizations"
      set "name_search" = lower(
        translate(
          "name",
          'ąĄćĆęĘłŁńŃóÓśŚźŹżŻáÁàÀâÂäÄãÃåÅæÆçÇéÉèÈêÊëËíÍìÌîÎïÏñÑóÓòÒôÔöÖõÕøØúÚùÙûÛüÜýÝÿŸ',
          'aAcCeElLnNoOsSzZzZaAaAaAaAaAaAaAcCeEeEeEeEiIiIiIiInNoOoOoOoOoOoOuUuUuUuUyYyY'
        )
      );
    `);

    // 3) Remap legacy `suspended` rows to `blocked` and emit a breadcrumb.
    this.addSql(`
      update "organizations"
      set "status"         = 'blocked',
          "blocked_at"     = coalesce("blocked_at", "updated_at"),
          "blocked_reason" = coalesce(
            "blocked_reason",
            'Auto-migrated from legacy ''suspended'' status (feature 026 consolidation).'
          )
      where "status" = 'suspended';
    `);

    // 4) Index on the denormalized search column.
    //    `text_pattern_ops` enables fast prefix ILIKE on the lowercased,
    //    diacritic-stripped name. Lookup at 10k rows is sub-millisecond.
    this.addSql(`
      create index "organizations_name_search_idx"
        on "organizations" ("name_search" text_pattern_ops);
    `);

    // 5) Per-org allow-list bridges. Empty rows for an org ⇒ "platform
    //    defaults apply" (FR-014 / FR-015 / FR-016).
    this.addSql(`
      create table "organization_payment_methods" (
        "organization_id" uuid not null,
        "payment_method_id" uuid not null,
        "created_at" timestamptz not null default now(),
        constraint "organization_payment_methods_pkey"
          primary key ("organization_id", "payment_method_id"),
        constraint "organization_payment_methods_organization_fk"
          foreign key ("organization_id") references "organizations" ("id") on delete cascade,
        constraint "organization_payment_methods_method_fk"
          foreign key ("payment_method_id") references "payment_methods" ("id") on delete cascade
      );
    `);

    this.addSql(`
      create table "organization_delivery_methods" (
        "organization_id" uuid not null,
        "delivery_method_id" uuid not null,
        "created_at" timestamptz not null default now(),
        constraint "organization_delivery_methods_pkey"
          primary key ("organization_id", "delivery_method_id"),
        constraint "organization_delivery_methods_organization_fk"
          foreign key ("organization_id") references "organizations" ("id") on delete cascade,
        constraint "organization_delivery_methods_method_fk"
          foreign key ("delivery_method_id") references "delivery_methods" ("id") on delete cascade
      );
    `);

    this.addSql(`
      create table "organization_warehouses" (
        "organization_id" uuid not null,
        "warehouse_id" uuid not null,
        "created_at" timestamptz not null default now(),
        constraint "organization_warehouses_pkey"
          primary key ("organization_id", "warehouse_id"),
        constraint "organization_warehouses_organization_fk"
          foreign key ("organization_id") references "organizations" ("id") on delete cascade,
        constraint "organization_warehouses_warehouse_fk"
          foreign key ("warehouse_id") references "warehouses" ("id") on delete cascade
      );
    `);

    // 7) Tax-id validation history.
    this.addSql(`
      create table "organization_tax_id_validations" (
        "id" uuid not null,
        "organization_id" uuid not null,
        "provider" varchar(32) not null,
        "outcome" varchar(16) not null,
        "tax_id_value" varchar(64) not null,
        "legal_name_returned" varchar(255) null,
        "address_returned" jsonb null,
        "error_kind" varchar(64) null,
        "requested_by_admin_user_id" uuid null,
        "created_at" timestamptz not null default now(),
        constraint "organization_tax_id_validations_pkey" primary key ("id"),
        constraint "organization_tax_id_validations_outcome_check"
          check ("outcome" in ('validated', 'failed', 'deferred', 'unverified')),
        constraint "organization_tax_id_validations_provider_check"
          check ("provider" in ('vies', 'mf_pl', 'format_only')),
        constraint "organization_tax_id_validations_organization_fk"
          foreign key ("organization_id") references "organizations" ("id") on delete cascade,
        constraint "organization_tax_id_validations_admin_user_fk"
          foreign key ("requested_by_admin_user_id") references "admin_users" ("id") on delete set null
      );
    `);

    this.addSql(`
      create index "organization_tax_id_validations_org_idx"
        on "organization_tax_id_validations" ("organization_id", "created_at" desc);
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "organization_tax_id_validations_org_idx";`);
    this.addSql(`drop table if exists "organization_tax_id_validations" cascade;`);
    this.addSql(`drop table if exists "organization_warehouses" cascade;`);
    this.addSql(`drop table if exists "organization_delivery_methods" cascade;`);
    this.addSql(`drop table if exists "organization_payment_methods" cascade;`);

    this.addSql(`drop index if exists "organizations_name_search_idx";`);

    this.addSql(`
      alter table "organizations"
        drop constraint if exists "organizations_approved_by_admin_user_fk",
        drop constraint if exists "organizations_vat_validation_outcome_check";
    `);

    this.addSql(`
      alter table "organizations"
        drop column if exists "version",
        drop column if exists "name_search",
        drop column if exists "approved_by_admin_user_id",
        drop column if exists "approved_at",
        drop column if exists "rejected_at",
        drop column if exists "rejected_reason",
        drop column if exists "blocked_at",
        drop column if exists "blocked_reason",
        drop column if exists "vat_validation_outcome",
        drop column if exists "vat_validation_provider",
        drop column if exists "vat_validated_at",
        drop column if exists "legal_name";
    `);
  }
}
