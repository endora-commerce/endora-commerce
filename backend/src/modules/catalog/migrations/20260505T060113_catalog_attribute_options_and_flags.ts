import { Migration } from '@mikro-orm/migrations';

/**
 * Catalog feature 012 / T004 — Attributes module reshape.
 *
 * Step-by-step reshape:
 *
 *   1. Add `label_default varchar(200) NOT NULL` on `product_attributes`,
 *      backfilled from the existing per-locale `label` JSONB.
 *   2. Add the four new behavioural columns + the numeric `filter_position`,
 *      defaulted to `false` / `0` so existing rows opt in only via operator
 *      action.
 *   3. Create the `attribute_options` table (rich per-option metadata for
 *      `select` / `enum` / `multiselect` types) with a UNIQUE on
 *      `(attribute_id, value)` and supporting indexes.
 *   4. Migrate every legacy `enum_values: string[]` JSONB into one
 *      `attribute_options` row per array element keyed by `(attribute_id,
 *      value)` with `label_default = value`. After this step the catalog
 *      module's reader code is migrated to the new table.
 *   5. Drop the legacy `enum_values` column.
 *
 * The `value_type` column is `varchar(16)` (not a PG enum) so the new
 * `'select'` literal is a service-layer change only — no DB migration
 * step needed for the type list itself.
 *
 * See specs/012-attributes/data-model.md §2 + research.md R-1, R-3, R-4.
 */
export class Migration20260505T060113CatalogAttributeOptionsAndFlags extends Migration {
  override async up(): Promise<void> {
    // 1. label_default — backfill from existing per-locale label JSONB.
    this.addSql(`
      alter table "product_attributes"
        add column "label_default" varchar(200) not null default '';
    `);
    this.addSql(`
      update "product_attributes"
      set "label_default" = coalesce(
        nullif(("label"->>'en-US'), ''),
        nullif(("label"->>'pl-PL'), ''),
        (select value from jsonb_each_text("label") limit 1),
        "key"
      )
      where "label_default" = '';
    `);
    this.addSql(`alter table "product_attributes" alter column "label_default" drop default;`);

    // 2. Four new flags + filter_position.
    this.addSql(`
      alter table "product_attributes"
        add column "is_required" boolean not null default false,
        add column "is_promo_rule" boolean not null default false,
        add column "filter_position" integer not null default 0,
        add column "is_visible_on_product_page" boolean not null default false;
    `);
    this.addSql(`
      create index "product_attributes_filter_position_idx"
        on "product_attributes" ("filter_position")
        where "is_filterable" = true;
    `);

    // 3. attribute_options table.
    this.addSql(`
      create table "attribute_options" (
        "id" uuid primary key default gen_random_uuid(),
        "attribute_id" uuid not null references "product_attributes"("id") on delete cascade,
        "value" varchar(200) not null,
        "label" jsonb not null default '{}'::jsonb,
        "label_default" varchar(200) not null,
        "is_default" boolean not null default false,
        "sort_order" integer not null default 0,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        unique ("attribute_id", "value")
      );
    `);
    this.addSql(`
      create index "attribute_options_by_attr_order_idx"
        on "attribute_options" ("attribute_id", "sort_order");
    `);
    this.addSql(`
      create index "attribute_options_default_per_attr_idx"
        on "attribute_options" ("attribute_id")
        where "is_default" = true;
    `);

    // 4. Migrate legacy enum_values → attribute_options rows.
    this.addSql(`
      insert into "attribute_options" ("attribute_id", "value", "label_default", "sort_order")
      select
        pa."id",
        v.value,
        v.value,
        (v.ord - 1)::integer
      from "product_attributes" pa
      cross join lateral jsonb_array_elements_text(pa."enum_values") with ordinality as v(value, ord)
      where pa."value_type" in ('enum', 'multiselect')
        and pa."enum_values" is not null
        and jsonb_array_length(pa."enum_values") > 0
        and v.value is not null
        and length(v.value) > 0
      on conflict ("attribute_id", "value") do nothing;
    `);

    // 5. Drop the legacy column.
    this.addSql(`alter table "product_attributes" drop column "enum_values";`);
  }

  override async down(): Promise<void> {
    // Reverse step 5 — recreate enum_values, repopulate from attribute_options.
    this.addSql(`alter table "product_attributes" add column "enum_values" jsonb null;`);
    this.addSql(`
      update "product_attributes" pa
      set "enum_values" = sub.values
      from (
        select "attribute_id", jsonb_agg("value" order by "sort_order") as values
        from "attribute_options"
        group by "attribute_id"
      ) sub
      where pa."id" = sub."attribute_id"
        and pa."value_type" in ('enum', 'multiselect');
    `);

    // Reverse step 3 — drop attribute_options.
    this.addSql(`drop index if exists "attribute_options_default_per_attr_idx";`);
    this.addSql(`drop index if exists "attribute_options_by_attr_order_idx";`);
    this.addSql(`drop table if exists "attribute_options";`);

    // Reverse step 2 — drop new flags.
    this.addSql(`drop index if exists "product_attributes_filter_position_idx";`);
    this.addSql(`
      alter table "product_attributes"
        drop column if exists "is_visible_on_product_page",
        drop column if exists "filter_position",
        drop column if exists "is_promo_rule",
        drop column if exists "is_required";
    `);

    // Reverse step 1 — drop label_default.
    this.addSql(`alter table "product_attributes" drop column if exists "label_default";`);
  }
}
