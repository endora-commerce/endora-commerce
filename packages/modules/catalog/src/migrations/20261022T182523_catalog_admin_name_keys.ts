import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 161, G15 redesign (`specs/161-price-book-editor/research.md` R14) —
 * a stored, indexed **admin name key** and **search key** per admin language on
 * `products`, so a 50 000-product price book pages and searches its product
 * lines by name without deriving 50 000 names per request.
 *
 * - `catalog_admin_display_name(name, sku, lang)`: for admin language `lang`,
 *   the non-empty name whose tag's primary subtag is `lang` — the first tag in
 *   `jsonb` key order (shorter first, then bytewise: `en` before `en-GB` before
 *   `en-US`), which is the order `price_lists`' `pickName` reads the same
 *   object in; else the same for English; else the first non-empty name; else
 *   the SKU.
 * - `catalog_admin_fold(text)`: lower case, `ł→l`, `đ→d`, `ø→o`, `ß→s`,
 *   `æ→a`, then NFKD with the combining marks removed. Its TypeScript twin is
 *   `foldAdminName` in `@endora-commerce/contracts`.
 * - `catalog_admin_name_key(name, sku, lang)` = the fold of the display name.
 * - Generated **stored** columns `admin_name_key_en|pl` (collation `"C"`:
 *   bytewise, locale-independent order) and `admin_search_key_en|pl` (the key,
 *   a space, the lower-cased SKU). Postgres maintains them on every insert and
 *   update — admin, import, bulk edit, PIM, SQL — so no write path can forget
 *   them; the ORM maps them read-only.
 * - Indexes: `products_admin_order_<lang>` btree `(key, sku, id) include
 *   (search key)` for the ordered walk; GIN trigram on the search key and on
 *   `lower(product_variants.sku)` for search.
 *
 * `pg_trgm` is created here (`if not exists`): it is a trusted extension, and
 * `catalog` must not rely on `product_feeds` having created it. `down` leaves
 * the extension, which other modules use.
 *
 * Adding a column rewrites `products` under an exclusive lock (measured
 * 3.5–7 s per column at 50 000 products); there is no production deployment.
 */
export class Migration20261022T182523CatalogAdminNameKeys extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create extension if not exists pg_trgm;`);
    this.addSql(`create or replace function catalog_admin_fold(value text) returns text
      language sql immutable parallel safe strict as $$
        select regexp_replace(
                 normalize(translate(lower(value), 'łđøßæ', 'ldosa'), NFKD),
                 '[\\u0300-\\u036f]', '', 'g')
      $$;`);
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
    this.addSql(`create index if not exists "product_variants_sku_lower_trgm"
      on "product_variants" using gin (lower("sku") gin_trgm_ops);`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "product_variants_sku_lower_trgm";`);
    for (const lang of ['en', 'pl']) {
      this.addSql(`drop index if exists "products_admin_search_${lang}_trgm";`);
      this.addSql(`drop index if exists "products_admin_order_${lang}";`);
      this.addSql(`alter table "products" drop column if exists "admin_search_key_${lang}";`);
      this.addSql(`alter table "products" drop column if exists "admin_name_key_${lang}";`);
    }
    this.addSql(`drop function if exists catalog_admin_name_key(jsonb, text, text);`);
    this.addSql(`drop function if exists catalog_admin_display_name(jsonb, text, text);`);
    this.addSql(`drop function if exists catalog_admin_fold(text);`);
  }
}
