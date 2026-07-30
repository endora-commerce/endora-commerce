import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 061 — Product Attributes on Custom Fields.
 *
 * Converges the legacy `product_attributes` registry onto the Custom Fields
 * layer (data-model.md §3, research §R5). Single transaction, six steps:
 *
 *   1. Assert no reserved-key (`name` / `description`) or pre-existing
 *      product-host definition collision — abort loudly otherwise.
 *   2. Insert one `custom_field_definitions` row per legacy attribute
 *      (`entity_type='product'`, value type mapped per research §R7,
 *      deterministic `sort_order` by `(created_at, key)`).
 *   3. Copy `attribute_options` → `custom_field_options` (new option ids —
 *      product data and filter URLs reference options by `value`).
 *   4. Reshape `product_attributes` into the catalog extension: add + backfill
 *      `custom_field_definition_id` (NOT NULL UNIQUE, FK RESTRICT),
 *      `select_display`, `numeric_kind`; drop `key`, `label`, `label_default`,
 *      `value_type`, `is_required`.
 *   5. Re-key `attribute_set_attributes.product_attribute_id` →
 *      `custom_field_definition_id` (values via the extension join; FK
 *      RESTRICT preserved).
 *   6. Drop `attribute_options`.
 *
 * `down()` reverses 6→1 — the §R7 map is bijective, so the legacy columns and
 * option rows are reconstructed from the CF rows, and the product-host
 * definitions/options are deleted.
 */
export class Migration20260723T230401CatalogAttributesOnCustomFields extends Migration {
  override async up(): Promise<void> {
    // -- Step 1: loud abort on reserved-key / pre-existing-definition collision.
    this.addSql(`
      do $$
      begin
        if exists (select 1 from "product_attributes" where "key" in ('name', 'description')) then
          raise exception 'attributes-on-custom-fields migration aborted: reserved system key (name/description) found in product_attributes';
        end if;
        if exists (
          select 1 from "custom_field_definitions" cfd
          join "product_attributes" pa on pa."key" = cfd."key"
          where cfd."entity_type" = 'product'
        ) then
          raise exception 'attributes-on-custom-fields migration aborted: colliding product-host custom_field_definitions rows already exist';
        end if;
      end $$;
    `);

    // -- Step 2: one definition per legacy attribute (type map per §R7).
    this.addSql(`
      insert into "custom_field_definitions"
        ("id", "entity_type", "key", "label", "label_default", "value_type",
         "required", "sort_order", "config", "created_at", "updated_at")
      select
        gen_random_uuid(),
        'product',
        pa."key",
        pa."label",
        pa."label_default",
        case pa."value_type"
          when 'string' then 'text'
          when 'price' then 'number'
          when 'enum' then 'select'
          else pa."value_type"
        end,
        pa."is_required",
        row_number() over (order by pa."created_at", pa."key") - 1,
        '{}'::jsonb,
        pa."created_at",
        pa."updated_at"
      from "product_attributes" pa;
    `);

    // -- Step 3: copy options (join attribute_id → key → definition_id).
    this.addSql(`
      insert into "custom_field_options"
        ("id", "definition_id", "value", "label", "label_default", "is_default",
         "sort_order", "created_at", "updated_at")
      select
        gen_random_uuid(),
        cfd."id",
        ao."value",
        ao."label",
        ao."label_default",
        ao."is_default",
        ao."sort_order",
        ao."created_at",
        ao."updated_at"
      from "attribute_options" ao
      join "product_attributes" pa on pa."id" = ao."attribute_id"
      join "custom_field_definitions" cfd
        on cfd."entity_type" = 'product' and cfd."key" = pa."key";
    `);

    // -- Step 4: reshape product_attributes into the extension.
    this.addSql(`
      alter table "product_attributes"
        add column "custom_field_definition_id" uuid null,
        add column "select_display" varchar(16) null,
        add column "numeric_kind" varchar(8) null;
    `);
    this.addSql(`
      update "product_attributes" pa
      set
        "custom_field_definition_id" = cfd."id",
        "select_display" = case pa."value_type"
          when 'enum' then 'pill'
          when 'select' then 'dropdown'
          else null
        end,
        "numeric_kind" = case pa."value_type"
          when 'number' then 'number'
          when 'price' then 'price'
          else null
        end
      from "custom_field_definitions" cfd
      where cfd."entity_type" = 'product' and cfd."key" = pa."key";
    `);
    this.addSql(`alter table "product_attributes" alter column "custom_field_definition_id" set not null;`);
    this.addSql(`
      alter table "product_attributes"
        add constraint "product_attributes_custom_field_definition_id_unique"
          unique ("custom_field_definition_id");
    `);
    this.addSql(`
      alter table "product_attributes"
        add constraint "fk_product_attributes_custom_field_definition"
          foreign key ("custom_field_definition_id")
          references "custom_field_definitions" ("id")
          on delete restrict;
    `);
    this.addSql(`
      alter table "product_attributes"
        drop column "key",
        drop column "label",
        drop column "label_default",
        drop column "value_type",
        drop column "is_required";
    `);

    // -- Step 5: re-key set membership onto definition ids.
    this.addSql(`
      alter table "attribute_set_attributes"
        drop constraint "fk_attribute_set_attributes_attribute";
    `);
    this.addSql(`
      alter table "attribute_set_attributes"
        rename column "product_attribute_id" to "custom_field_definition_id";
    `);
    this.addSql(`
      update "attribute_set_attributes" asa
      set "custom_field_definition_id" = pa."custom_field_definition_id"
      from "product_attributes" pa
      where pa."id" = asa."custom_field_definition_id";
    `);
    this.addSql(`
      alter table "attribute_set_attributes"
        add constraint "fk_attribute_set_attributes_definition"
          foreign key ("custom_field_definition_id")
          references "custom_field_definitions" ("id")
          on delete restrict;
    `);
    this.addSql(`
      alter index "attribute_set_attributes_attribute_id_index"
        rename to "attribute_set_attributes_definition_id_index";
    `);

    // -- Step 6: drop the legacy option table.
    this.addSql(`drop table "attribute_options";`);
  }

  override async down(): Promise<void> {
    // -- Reverse step 6: recreate attribute_options (shape from migration 032).
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

    // -- Reverse step 4: restore the legacy columns from the definitions
    //    (bijective §R7 map: cf type + select_display / numeric_kind).
    this.addSql(`
      alter table "product_attributes"
        add column "key" varchar(64) null,
        add column "label" jsonb null,
        add column "label_default" varchar(200) null,
        add column "value_type" varchar(16) null,
        add column "is_required" boolean not null default false;
    `);
    this.addSql(`
      update "product_attributes" pa
      set
        "key" = cfd."key",
        "label" = cfd."label",
        "label_default" = cfd."label_default",
        "is_required" = cfd."required",
        "value_type" = case cfd."value_type"
          when 'text' then 'string'
          when 'number' then coalesce(pa."numeric_kind", 'number')
          when 'select' then case when pa."select_display" = 'pill' then 'enum' else 'select' end
          else cfd."value_type"
        end
      from "custom_field_definitions" cfd
      where cfd."id" = pa."custom_field_definition_id";
    `);
    this.addSql(`alter table "product_attributes" alter column "key" set not null;`);
    this.addSql(`alter table "product_attributes" alter column "label" set not null;`);
    this.addSql(`alter table "product_attributes" alter column "label_default" set not null;`);
    this.addSql(`alter table "product_attributes" alter column "value_type" set not null;`);
    this.addSql(`
      alter table "product_attributes"
        add constraint "product_attributes_key_unique" unique ("key");
    `);

    // -- Reverse step 3: restore option rows (new ids; values preserved).
    this.addSql(`
      insert into "attribute_options"
        ("attribute_id", "value", "label", "label_default", "is_default",
         "sort_order", "created_at", "updated_at")
      select
        pa."id",
        cfo."value",
        cfo."label",
        cfo."label_default",
        cfo."is_default",
        cfo."sort_order",
        cfo."created_at",
        cfo."updated_at"
      from "custom_field_options" cfo
      join "product_attributes" pa on pa."custom_field_definition_id" = cfo."definition_id";
    `);

    // -- Reverse step 5: re-key set membership back onto extension ids.
    this.addSql(`
      alter table "attribute_set_attributes"
        drop constraint "fk_attribute_set_attributes_definition";
    `);
    this.addSql(`
      update "attribute_set_attributes" asa
      set "custom_field_definition_id" = pa."id"
      from "product_attributes" pa
      where pa."custom_field_definition_id" = asa."custom_field_definition_id";
    `);
    this.addSql(`
      alter table "attribute_set_attributes"
        rename column "custom_field_definition_id" to "product_attribute_id";
    `);
    this.addSql(`
      alter table "attribute_set_attributes"
        add constraint "fk_attribute_set_attributes_attribute"
          foreign key ("product_attribute_id")
          references "product_attributes" ("id")
          on delete restrict;
    `);
    this.addSql(`
      alter index "attribute_set_attributes_definition_id_index"
        rename to "attribute_set_attributes_attribute_id_index";
    `);

    // -- Reverse step 2: delete the product-host definitions (+ their options).
    this.addSql(`
      delete from "custom_field_options" cfo
      using "custom_field_definitions" cfd
      where cfd."id" = cfo."definition_id" and cfd."entity_type" = 'product';
    `);

    // -- Drop the extension columns (FK to definitions goes with them).
    this.addSql(`
      alter table "product_attributes"
        drop constraint "fk_product_attributes_custom_field_definition";
    `);
    this.addSql(`
      alter table "product_attributes"
        drop column "custom_field_definition_id",
        drop column "select_display",
        drop column "numeric_kind";
    `);

    this.addSql(`delete from "custom_field_definitions" where "entity_type" = 'product';`);
  }
}
