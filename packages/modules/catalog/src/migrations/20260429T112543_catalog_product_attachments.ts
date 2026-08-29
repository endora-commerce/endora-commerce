import { Migration } from '@mikro-orm/migrations';

/**
 * Catalog 002 — Attachments (T070, US3, data-model.md §2.5, §2.6).
 *
 * Two tables:
 *   - attachment_types: global dictionary (code, multilingual name,
 *     position). Seeded with 4 standard types: certificate, tech_spec,
 *     product_card, pdf. Idempotent ON CONFLICT (code) DO NOTHING.
 *   - product_attachments: cross-product wrapper around an Asset
 *     (research.md R-9). Composite of (product_id, asset_id,
 *     attachment_type_id, name, description, position). Asset is FK
 *     RESTRICT (Asset survives attachment unlink).
 */
export class Migration20260429T112543CatalogProductAttachments extends Migration {
  override async up(): Promise<void> {
    // -- attachment_types -----------------------------------------------------
    this.addSql(`
      create table "attachment_types" (
        "id" uuid not null,
        "code" varchar(64) not null,
        "name" jsonb not null,
        "position" int not null default 0,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "attachment_types_pkey" primary key ("id"),
        constraint "uniq_attachment_types_code" unique ("code")
      );
    `);
    // Seed 4 standard types with deterministic UUIDs (v4-shaped) so seeds
    // and tests can reference them stably.
    this.addSql(`
      insert into "attachment_types" ("id", "code", "name", "position", "created_at", "updated_at")
      values
        ('a77ac001-0000-4000-8000-000000000001', 'certificate',
         '{"en-US":"Certificate","pl-PL":"Certyfikat"}'::jsonb, 0, now(), now()),
        ('a77ac001-0000-4000-8000-000000000002', 'tech_spec',
         '{"en-US":"Technical specification","pl-PL":"Specyfikacja techniczna"}'::jsonb, 1, now(), now()),
        ('a77ac001-0000-4000-8000-000000000003', 'product_card',
         '{"en-US":"Product card","pl-PL":"Karta produktu"}'::jsonb, 2, now(), now()),
        ('a77ac001-0000-4000-8000-000000000004', 'pdf',
         '{"en-US":"PDF","pl-PL":"PDF"}'::jsonb, 3, now(), now())
      on conflict ("code") do nothing;
    `);

    // -- product_attachments --------------------------------------------------
    this.addSql(`
      create table "product_attachments" (
        "id" uuid not null,
        "product_id" uuid not null,
        "asset_id" uuid not null,
        "attachment_type_id" uuid not null,
        "name" varchar(160) not null,
        "description" text null,
        "position" int not null default 0,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "product_attachments_pkey" primary key ("id"),
        constraint "fk_product_attachments_product"
          foreign key ("product_id") references "products" ("id") on delete cascade,
        constraint "fk_product_attachments_asset"
          foreign key ("asset_id") references "assets" ("id") on delete restrict,
        constraint "fk_product_attachments_type"
          foreign key ("attachment_type_id") references "attachment_types" ("id") on delete restrict
      );
    `);
    this.addSql(
      'create index "product_attachments_product_id_index" on "product_attachments" ("product_id");',
    );
    this.addSql(
      'create index "product_attachments_attachment_type_id_index" on "product_attachments" ("attachment_type_id");',
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "product_attachments" cascade;');
    this.addSql('drop table if exists "attachment_types" cascade;');
  }
}
