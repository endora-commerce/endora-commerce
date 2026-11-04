import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 171 (`specs/171-blog-i18n-authors/` data-model §1.3, research R4) — the blog
 * URL prefixes each sales channel serves and has served.
 *
 * The settings module answers what a channel's prefix *is*; it cannot answer what it
 * *was* (`settings.value_changed` carries no old value). A `current` row per (channel,
 * language) is the prefix the blog last observed, and every `former` row is an address
 * that redirects to the current one. `language_code` null is the channel default
 * (`blog.url_prefix`). The built-in `blog` is never stored as `former`: the storefront
 * always redirects it. `sales_channel_id` references the channel like the other
 * `blog_*_sales_channels` columns, and goes with it.
 */
export class Migration20261103T112345BlogUrlPrefixes extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table if not exists "blog_url_prefixes" (
        "id" uuid not null,
        "sales_channel_id" uuid not null,
        "language_code" varchar(16) null,
        "prefix" varchar(64) not null,
        "state" varchar(8) not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "blog_url_prefixes_pkey" primary key ("id"),
        constraint "blog_url_prefixes_state_check" check ("state" in ('current', 'former')),
        constraint "blog_url_prefixes_channel_fk" foreign key ("sales_channel_id")
          references "sales_channels" ("id") on delete cascade
      );
    `);
    this.addSql(`
      create unique index if not exists "idx_blog_url_prefixes_current_uniq"
        on "blog_url_prefixes" ("sales_channel_id", coalesce("language_code", ''))
        where "state" = 'current';
    `);
    this.addSql(`
      create unique index if not exists "idx_blog_url_prefixes_prefix_uniq"
        on "blog_url_prefixes" ("sales_channel_id", coalesce("language_code", ''), "prefix");
    `);
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "blog_url_prefixes" cascade;');
  }
}
