import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 171 (`specs/171-blog-i18n-authors/` data-model §1.1–1.2, research R6) — a URL
 * key per language for posts and categories, and the former keys that redirect.
 *
 * One table for both kinds because posts and categories share one URL space
 * (`/<prefix>/<key>`), so the uniqueness probe is one query. `entity_id` names a post
 * or a category, so it has no foreign key; the services delete an entity's rows with
 * it. A key is unique per (channel, language) across both kinds — counting each
 * entity's base slug where it has no key, and every redirect — a rule no index can
 * express (the channels are the entity's, not the row's), so `BlogUrlKeyService`
 * enforces it under an advisory lock; the uniques here only stop an entity holding two
 * keys in one language. A redirect stores the entity, never a target key, so
 * redirects never chain.
 */
export class Migration20261103T134216BlogUrlKeysAndRedirects extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table if not exists "blog_url_keys" (
        "id" uuid not null,
        "entity_kind" varchar(16) not null,
        "entity_id" uuid not null,
        "language_code" varchar(16) not null,
        "key" varchar(160) not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "blog_url_keys_pkey" primary key ("id"),
        constraint "blog_url_keys_kind_check" check ("entity_kind" in ('post', 'category'))
      );
    `);
    this.addSql(`
      create unique index if not exists "idx_blog_url_keys_entity_language_uniq"
        on "blog_url_keys" ("entity_kind", "entity_id", lower("language_code"));
    `);
    this.addSql('create index if not exists "idx_blog_url_keys_language_key" on "blog_url_keys" (lower("language_code"), "key");');
    this.addSql(`
      create table if not exists "blog_url_redirects" (
        "id" uuid not null,
        "entity_kind" varchar(16) not null,
        "entity_id" uuid not null,
        "language_code" varchar(16) not null,
        "key" varchar(160) not null,
        "created_at" timestamptz not null default now(),
        constraint "blog_url_redirects_pkey" primary key ("id"),
        constraint "blog_url_redirects_kind_check" check ("entity_kind" in ('post', 'category'))
      );
    `);
    this.addSql(`
      create unique index if not exists "idx_blog_url_redirects_entity_key_uniq"
        on "blog_url_redirects" ("entity_kind", "entity_id", lower("language_code"), "key");
    `);
    this.addSql(
      'create index if not exists "idx_blog_url_redirects_language_key" on "blog_url_redirects" (lower("language_code"), "key");',
    );
    this.addSql(
      'create index if not exists "idx_blog_url_redirects_entity" on "blog_url_redirects" ("entity_kind", "entity_id");',
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "blog_url_redirects" cascade;');
    this.addSql('drop table if exists "blog_url_keys" cascade;');
  }
}
