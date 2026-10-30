import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 168 (`specs/168-product-editor-scope-switcher/data-model.md` §1–§3, §10; research R18,
 * R22) — the texts of the three-level scope model.
 *
 * `products.name` / `.description` become the **Global** text (one value, no language),
 * `product_attributes.scopable` replaces `channel_scoped` / `language_scoped`, a language-map
 * attribute value collapses to one value, every `product_value_overrides.value` is `{"v": …}`
 * (CHECKed), `products.scope_version` is the Save's version (R7), and the editor preferences are
 * emptied and CHECKed (no Language scope).
 *
 * Statement order (R22: backfill before every constraint):
 *  1. collapse language-map `attribute_values` of `language_scoped` attributes (before the flags go);
 *  2. drop the per-language admin indexes, generated columns and the two jsonb functions;
 *  3. convert `name` / `description` by add / update / not null / drop / rename — `ALTER … TYPE
 *     … USING` cannot hold the subquery — guarded by `data_type = 'jsonb'`;
 *  4. recreate `catalog_admin_name_key(text, text)`, the two generated columns and their indexes;
 *  5. `scopable` from the old flags, then drop them;
 *  6. wrap unwrapped override rows, then the CHECK;
 *  7. `scope_version`;
 *  8. empty the editor preferences, then their CHECK.
 *
 * The conversion pick (`en-US`, else the first non-empty value in jsonb key order — shorter keys
 * first, then bytewise — else the SKU) is a **dev-only convenience** that keeps a development
 * database usable; Global has no language and the pick carries no product meaning (FR-020). Every
 * statement is idempotent: a second run is a no-op.
 *
 * `down` restores the 163 **schema** (types, columns, functions, indexes) and none of its data —
 * not a data-preserving `down` (R18); it exists so the clean-run test can rebuild the shape
 * `up` meets, as 163's `product_status_drop_draft` does.
 */
export class Migration20261030T113855CatalogScopeModelTexts extends Migration {
  override async up(): Promise<void> {
    // Temporary pick helpers (dropped at the end).
    this.addSql(`create or replace function catalog_first_text(value jsonb) returns text
      language sql immutable parallel safe as $$
        select e.value from jsonb_each_text(case when jsonb_typeof(value) = 'object' then value else '{}'::jsonb end) e
         where e.value <> '' order by octet_length(e.key), e.key collate "C" limit 1
      $$;`);
    this.addSql(`create or replace function catalog_first_value(value jsonb) returns jsonb
      language sql immutable parallel safe as $$
        select coalesce(
          case when value -> 'en-US' not in ('""'::jsonb, 'null'::jsonb) then value -> 'en-US' end,
          (select e.value from jsonb_each(case when jsonb_typeof(value) = 'object' then value else '{}'::jsonb end) e
            where e.value not in ('""'::jsonb, 'null'::jsonb)
            order by octet_length(e.key), e.key collate "C" limit 1))
      $$;`);

    // 1. Language-map attribute values collapse to one value, while the flag still says which.
    this.addSql(`do $$
      declare attribute_key text;
      begin
        if exists (select 1 from information_schema.columns
                    where table_schema = current_schema() and table_name = 'product_attributes'
                      and column_name = 'language_scoped') then
          for attribute_key in
            execute 'select d.key from product_attributes pa join custom_field_definitions d on d.id = pa.custom_field_definition_id where pa.language_scoped'
          loop
            update products
               set attribute_values = case
                     when catalog_first_value(attribute_values -> attribute_key) is null then attribute_values - attribute_key
                     else jsonb_set(attribute_values, array[attribute_key], catalog_first_value(attribute_values -> attribute_key))
                   end
             where jsonb_typeof(attribute_values -> attribute_key) = 'object';
          end loop;
        end if;
      end $$;`);

    // 2. The per-language admin keys of feature 161 (migration 20261022T182523).
    for (const lang of ['en', 'pl']) {
      this.addSql(`drop index if exists "products_admin_search_${lang}_trgm";`);
      this.addSql(`drop index if exists "products_admin_order_${lang}";`);
      this.addSql(`alter table "products" drop column if exists "admin_search_key_${lang}";`);
      this.addSql(`alter table "products" drop column if exists "admin_name_key_${lang}";`);
    }
    this.addSql(`drop function if exists catalog_admin_name_key(jsonb, text, text);`);
    this.addSql(`drop function if exists catalog_admin_display_name(jsonb, text, text);`);

    // 3. name / description → the Global text.
    this.addSql(`do $$
      begin
        if (select data_type from information_schema.columns
             where table_schema = current_schema() and table_name = 'products' and column_name = 'name') = 'jsonb' then
          alter table products add column name_g text;
          update products set name_g = case
              when jsonb_typeof(name) = 'object' then coalesce(nullif(name ->> 'en-US', ''), catalog_first_text(name), sku)
              else coalesce(nullif(name #>> '{}', ''), sku)
            end;
          alter table products alter column name_g set not null;
          alter table products drop column name;
          alter table products rename column name_g to name;
        end if;
        if (select data_type from information_schema.columns
             where table_schema = current_schema() and table_name = 'products' and column_name = 'description') = 'jsonb' then
          alter table products add column description_g text;
          update products set description_g = case
              when jsonb_typeof(description) = 'object' then coalesce(nullif(description ->> 'en-US', ''), catalog_first_text(description))
              else nullif(description #>> '{}', '')
            end;
          alter table products drop column description;
          alter table products rename column description_g to description;
        end if;
      end $$;`);

    // 4. One admin key pair over the Global name (else the SKU).
    this.addSql(`create or replace function catalog_admin_name_key(name text, sku text) returns text
      language sql immutable parallel safe as $$
        select catalog_admin_fold(coalesce(nullif(name, ''), sku))
      $$;`);
    this.addSql(`alter table "products"
      add column if not exists "admin_name_key" text collate "C"
        generated always as (catalog_admin_name_key("name", "sku")) stored;`);
    this.addSql(`alter table "products"
      add column if not exists "admin_search_key" text collate "C"
        generated always as (catalog_admin_name_key("name", "sku") || ' ' || lower("sku")) stored;`);
    this.addSql(`create index if not exists "products_admin_order"
      on "products" ("admin_name_key", "sku", "id") include ("admin_search_key");`);
    this.addSql(`create index if not exists "products_admin_search_trgm"
      on "products" using gin ("admin_search_key" gin_trgm_ops);`);

    // 5. One scope flag (R15).
    this.addSql(`alter table "product_attributes" add column if not exists "scopable" boolean not null default false;`);
    this.addSql(`do $$
      begin
        if exists (select 1 from information_schema.columns
                    where table_schema = current_schema() and table_name = 'product_attributes'
                      and column_name = 'language_scoped') then
          update product_attributes set scopable = channel_scoped or language_scoped;
          alter table product_attributes drop column channel_scoped;
          alter table product_attributes drop column language_scoped;
        end if;
      end $$;`);

    // 6. Every override value is `{"v": …}`; `{"v": null}` is an empty override (FR-013).
    this.addSql(`update "product_value_overrides" set "value" = jsonb_build_object('v', "value")
      where not (jsonb_typeof("value") = 'object' and jsonb_exists("value", 'v'));`);
    this.addSql(`alter table "product_value_overrides" drop constraint if exists "product_value_overrides_value_wrapped";`);
    this.addSql(`alter table "product_value_overrides" add constraint "product_value_overrides_value_wrapped"
      check (jsonb_typeof("value") = 'object' and jsonb_exists("value", 'v'));`);

    // 7. The Save's version (R7).
    this.addSql(`alter table "products" add column if not exists "scope_version" bigint not null default 0;`);

    // 8. The 163 preference encoding is gone (a `null` language meant "primary admin language").
    this.addSql(`do $$
      begin
        if not exists (select 1 from pg_constraint where conname = 'product_editor_preferences_scope_check') then
          delete from product_editor_preferences;
          alter table product_editor_preferences add constraint product_editor_preferences_scope_check
            check (last_channel_id is not null or last_language_code is null);
        end if;
      end $$;`);

    this.addSql(`drop function if exists catalog_first_value(jsonb);`);
    this.addSql(`drop function if exists catalog_first_text(jsonb);`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "product_editor_preferences" drop constraint if exists "product_editor_preferences_scope_check";`);
    this.addSql(`alter table "products" drop column if exists "scope_version";`);
    this.addSql(`alter table "product_value_overrides" drop constraint if exists "product_value_overrides_value_wrapped";`);
    this.addSql(`alter table "product_attributes" add column if not exists "channel_scoped" boolean not null default false;`);
    this.addSql(`alter table "product_attributes" add column if not exists "language_scoped" boolean not null default false;`);
    this.addSql(`do $$
      begin
        if exists (select 1 from information_schema.columns
                    where table_schema = current_schema() and table_name = 'product_attributes' and column_name = 'scopable') then
          update product_attributes set channel_scoped = scopable, language_scoped = scopable;
          alter table product_attributes drop column scopable;
        end if;
      end $$;`);
    this.addSql(`drop index if exists "products_admin_search_trgm";`);
    this.addSql(`drop index if exists "products_admin_order";`);
    this.addSql(`alter table "products" drop column if exists "admin_search_key";`);
    this.addSql(`alter table "products" drop column if exists "admin_name_key";`);
    this.addSql(`drop function if exists catalog_admin_name_key(text, text);`);
    this.addSql(`do $$
      begin
        if (select data_type from information_schema.columns
             where table_schema = current_schema() and table_name = 'products' and column_name = 'name') = 'text' then
          alter table products add column name_j jsonb;
          update products set name_j = jsonb_build_object('en-US', name);
          alter table products alter column name_j set not null;
          alter table products drop column name;
          alter table products rename column name_j to name;
        end if;
        if (select data_type from information_schema.columns
             where table_schema = current_schema() and table_name = 'products' and column_name = 'description') = 'text' then
          alter table products add column description_j jsonb;
          update products set description_j = case when description is null then '{}'::jsonb else jsonb_build_object('en-US', description) end;
          alter table products alter column description_j set not null;
          alter table products drop column description;
          alter table products rename column description_j to description;
        end if;
      end $$;`);
    // Feature 161's per-language keys (20261022T182523), as it created them.
    this.addSql(`create or replace function catalog_admin_display_name(name jsonb, sku text, lang text) returns text
      language sql immutable parallel safe as $$
        select coalesce(
          (select n.value from jsonb_each_text(case when jsonb_typeof(name) = 'object' then name else '{}'::jsonb end) n
            where n.value <> '' and lower(split_part(n.key, '-', 1)) = lower(lang)
            order by octet_length(n.key), n.key collate "C" limit 1),
          (select n.value from jsonb_each_text(case when jsonb_typeof(name) = 'object' then name else '{}'::jsonb end) n
            where n.value <> '' and lower(split_part(n.key, '-', 1)) = 'en'
            order by octet_length(n.key), n.key collate "C" limit 1),
          (select n.value from jsonb_each_text(case when jsonb_typeof(name) = 'object' then name else '{}'::jsonb end) n
            where n.value <> ''
            order by octet_length(n.key), n.key collate "C" limit 1),
          sku)
      $$;`);
    this.addSql(`create or replace function catalog_admin_name_key(name jsonb, sku text, lang text) returns text
      language sql immutable parallel safe as $$
        select catalog_admin_fold(catalog_admin_display_name(name, sku, lang))
      $$;`);
    for (const lang of ['en', 'pl']) {
      this.addSql(`alter table "products"
        add column if not exists "admin_name_key_${lang}" text collate "C"
          generated always as (catalog_admin_name_key("name", "sku", '${lang}')) stored;`);
      this.addSql(`alter table "products"
        add column if not exists "admin_search_key_${lang}" text collate "C"
          generated always as (catalog_admin_name_key("name", "sku", '${lang}') || ' ' || lower("sku")) stored;`);
      this.addSql(`create index if not exists "products_admin_order_${lang}"
        on "products" ("admin_name_key_${lang}", "sku", "id") include ("admin_search_key_${lang}");`);
      this.addSql(`create index if not exists "products_admin_search_${lang}_trgm"
        on "products" using gin ("admin_search_key_${lang}" gin_trgm_ops);`);
    }
  }
}
