import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 168 (`specs/168-product-editor-scope-switcher/data-model.md` §5, `contracts/url-keys.md`;
 * research R12, spec round 7) — URL keys at Channel and Channel × language, redirects per
 * (channel, language). Replaces 163 data-model §5.
 *
 * Both tables are **recreated**: every 163 language key (`sales_channel_id null`) and every
 * redirect is dropped (FR-020); a development database keeps working on `products.slug`.
 * `product_url_keys_one_product_per_channel_key` makes "a key text belongs to one product per
 * channel, across all the channel's languages, orphans included" a database rule; it needs
 * `btree_gist` (an extension shipped with PostgreSQL; plan *Complexity Tracking*). The slug and
 * redirect halves of the rule are `UrlKeyService.lockAndCheck`'s (T039).
 *
 * Idempotent: the recreation runs only while the 163 shape (a nullable `sales_channel_id`) is
 * there. `down` restores the 163 tables, empty — not a data-preserving `down` (R18).
 */
export class Migration20261030T113904CatalogScopeModelUrlKeys extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create extension if not exists btree_gist;`);
    this.addSql(`do $$
      begin
        if (select is_nullable from information_schema.columns where table_schema = current_schema()
             and table_name = 'product_url_keys' and column_name = 'sales_channel_id') = 'YES' then
          drop table product_url_redirects;
          drop table product_url_keys;
        end if;
      end $$;`);
    this.addSql(`create table if not exists "product_url_keys" (
        "id" uuid not null,
        "product_id" uuid not null references "products"("id") on delete cascade,
        "sales_channel_id" uuid not null references "sales_channels"("id") on delete cascade,
        "language_code" varchar(16) null,
        "key" varchar(160) not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "product_url_keys_pkey" primary key ("id"),
        constraint "product_url_keys_one_product_per_channel_key"
          exclude using gist ("sales_channel_id" with =, "key" with =, "product_id" with <>)
      );`);
    this.addSql(`create unique index if not exists "product_url_keys_channel_key_unique"
      on "product_url_keys" ("sales_channel_id", "key") where "language_code" is null;`);
    this.addSql(`create unique index if not exists "product_url_keys_channel_language_key_unique"
      on "product_url_keys" ("sales_channel_id", "language_code", "key") where "language_code" is not null;`);
    this.addSql(`create unique index if not exists "product_url_keys_product_channel_unique"
      on "product_url_keys" ("product_id", "sales_channel_id") where "language_code" is null;`);
    this.addSql(`create unique index if not exists "product_url_keys_product_channel_language_unique"
      on "product_url_keys" ("product_id", "sales_channel_id", "language_code") where "language_code" is not null;`);
    // The partial uniques do not serve unqualified reads: per-product reads and cascades, and the
    // Global-key check against every row key.
    this.addSql(`create index if not exists "product_url_keys_product_idx" on "product_url_keys" ("product_id");`);
    this.addSql(`create index if not exists "product_url_keys_key_idx" on "product_url_keys" ("key");`);

    this.addSql(`create table if not exists "product_url_redirects" (
        "id" uuid not null,
        "product_id" uuid not null references "products"("id") on delete cascade,
        "sales_channel_id" uuid not null references "sales_channels"("id") on delete cascade,
        "language_code" varchar(16) not null,
        "key" varchar(160) not null,
        "created_at" timestamptz not null default now(),
        constraint "product_url_redirects_pkey" primary key ("id")
      );`);
    this.addSql(`create unique index if not exists "product_url_redirects_channel_language_key_unique"
      on "product_url_redirects" ("sales_channel_id", "language_code", "key");`);
    this.addSql(`create index if not exists "product_url_redirects_product_idx" on "product_url_redirects" ("product_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`do $$
      begin
        if (select is_nullable from information_schema.columns where table_schema = current_schema()
             and table_name = 'product_url_keys' and column_name = 'sales_channel_id') = 'NO' then
          drop table product_url_redirects;
          drop table product_url_keys;
        end if;
      end $$;`);
    // 163's tables (20261022T054223), as it created them.
    this.addSql(`create table if not exists "product_url_keys" (
        "id" uuid not null,
        "product_id" uuid not null references "products"("id") on delete cascade,
        "language_code" varchar(16) not null,
        "sales_channel_id" uuid null references "sales_channels"("id") on delete cascade,
        "key" varchar(160) not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "product_url_keys_pkey" primary key ("id")
      );`);
    this.addSql(`create unique index if not exists "product_url_keys_product_language_unique"
      on "product_url_keys" ("product_id", "language_code") where "sales_channel_id" is null;`);
    this.addSql(`create unique index if not exists "product_url_keys_product_channel_language_unique"
      on "product_url_keys" ("product_id", "sales_channel_id", "language_code") where "sales_channel_id" is not null;`);
    this.addSql(`create index if not exists "product_url_keys_language_key_idx" on "product_url_keys" ("language_code", "key");`);
    this.addSql(`create index if not exists "product_url_keys_key_idx" on "product_url_keys" ("key");`);
    this.addSql(`create index if not exists "product_url_keys_product_idx" on "product_url_keys" ("product_id");`);
    this.addSql(`create table if not exists "product_url_redirects" (
        "id" uuid not null,
        "product_id" uuid not null references "products"("id") on delete cascade,
        "language_code" varchar(16) null,
        "key" varchar(160) not null,
        "created_at" timestamptz not null default now(),
        constraint "product_url_redirects_pkey" primary key ("id")
      );`);
    this.addSql(`create unique index if not exists "product_url_redirects_language_key_unique"
      on "product_url_redirects" ("language_code", "key") where "language_code" is not null;`);
    this.addSql(`create unique index if not exists "product_url_redirects_global_key_unique"
      on "product_url_redirects" ("key") where "language_code" is null;`);
    this.addSql(`create index if not exists "product_url_redirects_key_idx" on "product_url_redirects" ("key");`);
    this.addSql(`create index if not exists "product_url_redirects_product_idx" on "product_url_redirects" ("product_id");`);
  }
}
