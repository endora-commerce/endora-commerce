import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 168 (`specs/168-product-editor-scope-switcher/data-model.md` §6–§7; research R2, R22) —
 * the gallery, attachment and packaging-unit values at Channel and Channel × language move to one
 * override table per family, beside a Global value on the subject row. Replaces 163 data-model
 * §7–§8.
 *
 * Statement order (data-model §7): new Global columns with defaults → `unique (id, product_id)` on
 * the three subject tables (the targets of the composite FKs) → the four override tables with their
 * constraints → drop 163's three channel tables and the `*_translations` columns → `alt_text`
 * jsonb → text by add / update / drop / rename (the Global alt text: `en-US`, else the first
 * non-empty value in key order — a dev-only convenience, FR-020). 163's channel rows are not
 * carried over.
 *
 * Every override table references its subject with a **composite** FK `(subject_id, product_id)`,
 * so an override can never point at another product's subject. The gallery-role holder FK is
 * composite and nullable (`match simple`) and cascades: a removed holder makes the role inherit
 * again rather than silently become "no image" (`set null` would turn it into the empty override).
 * Readers detect an empty override with `jsonb_typeof(value -> 'v') = 'null'`, never `->>` (R22);
 * the per-field type CHECKs keep `hidden` a boolean and the texts a string or the empty override.
 *
 * Idempotent: every statement is guarded. `down` restores the 163 shape and none of its data —
 * not a data-preserving `down` (R18).
 */

const SUBJECT_UNIQUES: ReadonlyArray<readonly [string, string]> = [
  ['gallery_items', 'gallery_items_id_product_unique'],
  ['product_attachments', 'product_attachments_id_product_unique'],
  ['product_packaging_units', 'product_packaging_units_id_product_unique'],
];

const WRAPPED = `jsonb_typeof("value") = 'object' and jsonb_exists("value", 'v')`;
const TEXT_OR_EMPTY = `jsonb_typeof("value" -> 'v') in ('string', 'null')`;
const BOOLEAN = `jsonb_typeof("value" -> 'v') = 'boolean'`;

/** The shared column set of a subject's override table (data-model §6a). */
function overrideTable(table: string, subjectColumn: string, subjectTable: string, fields: readonly string[], checks: string): string {
  return `create table if not exists "${table}" (
      "id" uuid not null,
      "${subjectColumn}" uuid not null,
      "product_id" uuid not null references "products"("id") on delete cascade,
      "sales_channel_id" uuid not null references "sales_channels"("id") on delete cascade,
      "language_code" varchar(16) null,
      "field" varchar(16) not null,
      "value" jsonb not null,
      "created_at" timestamptz not null default now(),
      "updated_at" timestamptz not null default now(),
      constraint "${table}_pkey" primary key ("id"),
      constraint "${table}_subject_fk" foreign key ("${subjectColumn}", "product_id")
        references "${subjectTable}" ("id", "product_id") on delete cascade,
      constraint "${table}_field_check" check ("field" in (${fields.map((f) => `'${f}'`).join(', ')})),
      constraint "${table}_value_wrapped" check (${WRAPPED}),
      constraint "${table}_value_type" check (${checks})
    );`;
}

export class Migration20261030T113908CatalogScopeModelMedia extends Migration {
  override async up(): Promise<void> {
    // Global columns.
    this.addSql(`alter table "gallery_items" add column if not exists "hidden" boolean not null default false;`);
    this.addSql(`alter table "product_attachments" add column if not exists "hidden" boolean not null default false;`);

    // Targets of the composite FKs.
    for (const [table, name] of SUBJECT_UNIQUES) {
      this.addSql(`do $$
        begin
          if not exists (select 1 from pg_constraint where conname = '${name}') then
            alter table "${table}" add constraint "${name}" unique ("id", "product_id");
          end if;
        end $$;`);
    }

    // §6a — gallery item alt text and hidden flag.
    this.addSql(
      overrideTable(
        'gallery_item_scope_overrides',
        'gallery_item_id',
        'gallery_items',
        ['alt_text', 'hidden'],
        `("field" <> 'hidden' or ${BOOLEAN}) and ("field" <> 'alt_text' or ${TEXT_OR_EMPTY})`,
      ),
    );
    this.addSql(`create unique index if not exists "gallery_item_scope_overrides_channel_unique"
      on "gallery_item_scope_overrides" ("gallery_item_id", "field", "sales_channel_id") where "language_code" is null;`);
    this.addSql(`create unique index if not exists "gallery_item_scope_overrides_channel_language_unique"
      on "gallery_item_scope_overrides" ("gallery_item_id", "field", "sales_channel_id", "language_code") where "language_code" is not null;`);
    this.addSql(`create index if not exists "gallery_item_scope_overrides_item_idx" on "gallery_item_scope_overrides" ("gallery_item_id");`);
    this.addSql(`create index if not exists "gallery_item_scope_overrides_product_idx" on "gallery_item_scope_overrides" ("product_id");`);

    // §6b — gallery role holders; `gallery_item_id null` = no image holds the role at the scope.
    this.addSql(`create table if not exists "gallery_role_scope_overrides" (
        "id" uuid not null,
        "product_id" uuid not null references "products"("id") on delete cascade,
        "sales_channel_id" uuid not null references "sales_channels"("id") on delete cascade,
        "language_code" varchar(16) null,
        "label" varchar(16) not null,
        "gallery_item_id" uuid null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "gallery_role_scope_overrides_pkey" primary key ("id"),
        constraint "gallery_role_scope_overrides_holder_fk" foreign key ("gallery_item_id", "product_id")
          references "gallery_items" ("id", "product_id") match simple on delete cascade,
        constraint "gallery_role_scope_overrides_label_check"
          check ("label" in ('base_image', 'small_image', 'thumbnail'))
      );`);
    this.addSql(`create unique index if not exists "gallery_role_scope_overrides_channel_unique"
      on "gallery_role_scope_overrides" ("product_id", "label", "sales_channel_id") where "language_code" is null;`);
    this.addSql(`create unique index if not exists "gallery_role_scope_overrides_channel_language_unique"
      on "gallery_role_scope_overrides" ("product_id", "label", "sales_channel_id", "language_code") where "language_code" is not null;`);
    this.addSql(`create index if not exists "gallery_role_scope_overrides_product_idx" on "gallery_role_scope_overrides" ("product_id");`);
    this.addSql(`create index if not exists "gallery_role_scope_overrides_item_idx" on "gallery_role_scope_overrides" ("gallery_item_id");`);

    // §7 — attachment name, description and hidden flag.
    this.addSql(
      overrideTable(
        'product_attachment_scope_overrides',
        'attachment_id',
        'product_attachments',
        ['name', 'description', 'hidden'],
        `("field" <> 'hidden' or ${BOOLEAN}) and ("field" = 'hidden' or ${TEXT_OR_EMPTY})`,
      ),
    );
    this.addSql(`create unique index if not exists "product_attachment_scope_overrides_channel_unique"
      on "product_attachment_scope_overrides" ("attachment_id", "field", "sales_channel_id") where "language_code" is null;`);
    this.addSql(`create unique index if not exists "product_attachment_scope_overrides_channel_language_unique"
      on "product_attachment_scope_overrides" ("attachment_id", "field", "sales_channel_id", "language_code") where "language_code" is not null;`);
    this.addSql(`create index if not exists "product_attachment_scope_overrides_attachment_idx" on "product_attachment_scope_overrides" ("attachment_id");`);
    this.addSql(`create index if not exists "product_attachment_scope_overrides_product_idx" on "product_attachment_scope_overrides" ("product_id");`);

    // §7 — packaging-unit name.
    this.addSql(
      overrideTable(
        'product_packaging_unit_scope_overrides',
        'packaging_unit_id',
        'product_packaging_units',
        ['name'],
        TEXT_OR_EMPTY,
      ),
    );
    this.addSql(`create unique index if not exists "product_packaging_unit_scope_overrides_channel_unique"
      on "product_packaging_unit_scope_overrides" ("packaging_unit_id", "field", "sales_channel_id") where "language_code" is null;`);
    this.addSql(`create unique index if not exists "product_packaging_unit_scope_overrides_channel_language_unique"
      on "product_packaging_unit_scope_overrides" ("packaging_unit_id", "field", "sales_channel_id", "language_code") where "language_code" is not null;`);
    this.addSql(`create index if not exists "product_packaging_unit_scope_overrides_unit_idx" on "product_packaging_unit_scope_overrides" ("packaging_unit_id");`);
    this.addSql(`create index if not exists "product_packaging_unit_scope_overrides_product_idx" on "product_packaging_unit_scope_overrides" ("product_id");`);

    // 163's channel tables and translation maps go (FR-020).
    this.addSql(`drop table if exists "gallery_item_channel_labels";`);
    this.addSql(`drop table if exists "gallery_item_channel_hidden";`);
    this.addSql(`drop table if exists "product_attachment_channel_hidden";`);
    this.addSql(`alter table "product_attachments" drop column if exists "name_translations";`);
    this.addSql(`alter table "product_attachments" drop column if exists "description_translations";`);
    this.addSql(`alter table "product_packaging_units" drop column if exists "name_translations";`);

    // `gallery_items.alt_text` jsonb → the Global text.
    this.addSql(`do $$
      begin
        if (select data_type from information_schema.columns where table_schema = current_schema()
             and table_name = 'gallery_items' and column_name = 'alt_text') = 'jsonb' then
          alter table gallery_items add column alt_text_g text;
          update gallery_items set alt_text_g = coalesce(
              nullif(alt_text ->> 'en-US', ''),
              (select e.value from jsonb_each_text(case when jsonb_typeof(alt_text) = 'object' then alt_text else '{}'::jsonb end) e
                where e.value <> '' order by octet_length(e.key), e.key collate "C" limit 1));
          alter table gallery_items drop column alt_text;
          alter table gallery_items rename column alt_text_g to alt_text;
        end if;
      end $$;`);
  }

  override async down(): Promise<void> {
    this.addSql(`do $$
      begin
        if (select data_type from information_schema.columns where table_schema = current_schema()
             and table_name = 'gallery_items' and column_name = 'alt_text') = 'text' then
          alter table gallery_items add column alt_text_j jsonb not null default '{}'::jsonb;
          update gallery_items set alt_text_j = jsonb_build_object('en-US', alt_text) where alt_text is not null;
          alter table gallery_items drop column alt_text;
          alter table gallery_items rename column alt_text_j to alt_text;
        end if;
      end $$;`);
    this.addSql(`drop table if exists "product_packaging_unit_scope_overrides";`);
    this.addSql(`drop table if exists "product_attachment_scope_overrides";`);
    this.addSql(`drop table if exists "gallery_role_scope_overrides";`);
    this.addSql(`drop table if exists "gallery_item_scope_overrides";`);
    for (const [table, name] of SUBJECT_UNIQUES) {
      this.addSql(`alter table "${table}" drop constraint if exists "${name}";`);
    }
    this.addSql(`alter table "product_attachments" drop column if exists "hidden";`);
    this.addSql(`alter table "gallery_items" drop column if exists "hidden";`);
    // 163's shape (20261026T033453, 20261026T084533), as they created it.
    this.addSql(`alter table "product_attachments" add column if not exists "name_translations" jsonb not null default '{}'::jsonb;`);
    this.addSql(`alter table "product_attachments" add column if not exists "description_translations" jsonb not null default '{}'::jsonb;`);
    this.addSql(`alter table "product_packaging_units" add column if not exists "name_translations" jsonb not null default '{}'::jsonb;`);
    this.addSql(`create table if not exists "gallery_item_channel_labels" (
        "product_id" uuid not null references "products"("id") on delete cascade,
        "sales_channel_id" uuid not null references "sales_channels"("id") on delete cascade,
        "label" varchar(16) not null,
        "gallery_item_id" uuid not null references "gallery_items"("id") on delete cascade,
        constraint "gallery_item_channel_labels_pkey" primary key ("product_id", "sales_channel_id", "label"),
        constraint "chk_gallery_item_channel_labels_label"
          check ("label" in ('base_image', 'small_image', 'thumbnail'))
      );`);
    this.addSql(`create index if not exists "gallery_item_channel_labels_item_idx" on "gallery_item_channel_labels" ("gallery_item_id");`);
    this.addSql(`create table if not exists "gallery_item_channel_hidden" (
        "gallery_item_id" uuid not null references "gallery_items"("id") on delete cascade,
        "sales_channel_id" uuid not null references "sales_channels"("id") on delete cascade,
        "product_id" uuid not null references "products"("id") on delete cascade,
        constraint "gallery_item_channel_hidden_pkey" primary key ("gallery_item_id", "sales_channel_id")
      );`);
    this.addSql(`create index if not exists "gallery_item_channel_hidden_product_channel_idx" on "gallery_item_channel_hidden" ("product_id", "sales_channel_id");`);
    this.addSql(`create table if not exists "product_attachment_channel_hidden" (
        "attachment_id" uuid not null references "product_attachments"("id") on delete cascade,
        "sales_channel_id" uuid not null references "sales_channels"("id") on delete cascade,
        "product_id" uuid not null references "products"("id") on delete cascade,
        constraint "product_attachment_channel_hidden_pkey" primary key ("attachment_id", "sales_channel_id")
      );`);
    this.addSql(`create index if not exists "product_attachment_channel_hidden_product_channel_idx" on "product_attachment_channel_hidden" ("product_id", "sales_channel_id");`);
  }
}
