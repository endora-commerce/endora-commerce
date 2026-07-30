import { Migration } from '@mikro-orm/migrations';

/**
 * SEO module init (T235). Two tables:
 *   - seo_meta_overrides: per-(entity, locale) editorial overrides.
 *   - sitemap_cache: singleton cache row for the public XML sitemap.
 */
export class Migration20260425T154404SeoInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "seo_meta_overrides" (
        "id" uuid not null,
        "entity_type" varchar(32) not null,
        "entity_id" uuid not null,
        "locale" varchar(10) not null,
        "title" varchar(160) null,
        "description" varchar(400) null,
        "og_title" varchar(160) null,
        "og_description" varchar(400) null,
        "og_image_url" varchar(2048) null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "seo_meta_overrides_pkey" primary key ("id"),
        constraint "uniq_seo_meta_overrides_entity_locale"
          unique ("entity_type", "entity_id", "locale")
      );
    `);
    this.addSql('create index "seo_meta_overrides_entity_type_index" on "seo_meta_overrides" ("entity_type");');
    this.addSql('create index "seo_meta_overrides_entity_id_index" on "seo_meta_overrides" ("entity_id");');

    this.addSql(`
      create table "sitemap_cache" (
        "key" varchar(32) not null,
        "payload" text not null,
        "url_count" int not null default 0,
        "byte_size" int not null default 0,
        "generated_at" timestamptz not null,
        constraint "sitemap_cache_pkey" primary key ("key")
      );
    `);
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "sitemap_cache" cascade;');
    this.addSql('drop table if exists "seo_meta_overrides" cascade;');
  }
}
