import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 067 Phase 11 — taxonomy revision refresh (data-model §§8, 14;
 * FR-086 – FR-099).
 *
 * Two changes, both additive:
 *
 *  - `product_feed_taxonomies` gains its provenance and lifecycle columns. A
 *    revision now records **where it came from** (bundled with the image or
 *    fetched from a source URL), the content identity that makes "the same file
 *    again" a cheap comparison, and the three timestamps the revisions list and
 *    the retention selector read: `fetched_at`, `promoted_at`, `superseded_at`.
 *    Existing rows are backfilled `source = 'bundled'`, which is exactly what
 *    they are.
 *  - `product_feed_taxonomy_checks` records every check — success, no-change,
 *    rejection or transport failure — so an operator can tell a healthy weekly
 *    check from a silent one, and so the notifier's "once per transition into
 *    failure" rule has a history to read rather than a counter to maintain.
 *
 * The partial unique index on `(provider_code, source_content_hash)` is the one
 * worth explaining: it makes "we already have these bytes" a database fact
 * rather than a race between two workers checking the same provider. It is
 * partial because a bundled revision has no content hash, and several of them
 * coexist per provider.
 *
 * **No cross-module foreign key is added**, so the module's manifest
 * `dependencies` are unchanged.
 */
export class Migration20260803T060153ProductFeedsTaxonomyRefresh extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "product_feed_taxonomies"
        add column "source" varchar(16) not null default 'bundled',
        add column "source_urls" jsonb not null default '{}',
        add column "source_content_hash" varchar(64) null,
        add column "source_etag" varchar(255) null,
        add column "fetched_at" timestamptz null,
        add column "promoted_at" timestamptz null,
        add column "superseded_at" timestamptz null,
        add column "flags" jsonb not null default '[]';
    `);
    // Every row that exists today arrived with the platform image.
    this.addSql(`update "product_feed_taxonomies" set "source" = 'bundled';`);

    this.addSql(
      `create unique index "product_feed_taxonomies_content_hash_uq" on "product_feed_taxonomies" ("provider_code", "source_content_hash") where "source_content_hash" is not null;`,
    );
    this.addSql(
      `create index "product_feed_taxonomies_provider_installed_idx" on "product_feed_taxonomies" ("provider_code", "installed_at" desc);`,
    );

    this.addSql(`
      create table "product_feed_taxonomy_checks" (
        "id" uuid not null,
        "provider_code" varchar(32) not null,
        "trigger" varchar(16) not null,
        "started_at" timestamptz not null,
        "finished_at" timestamptz null,
        "outcome" varchar(24) null,
        "reason" varchar(32) null,
        "detail" varchar(500) null,
        "http_status" int null,
        "bytes_read" int null,
        "content_hash" varchar(64) null,
        "installed_taxonomy_id" uuid null,
        "created_at" timestamptz not null,
        constraint "product_feed_taxonomy_checks_pkey" primary key ("id")
      );
    `);
    // SET NULL, not CASCADE: retention purging a superseded revision must not
    // erase the record that it was ever fetched.
    this.addSql(`
      alter table "product_feed_taxonomy_checks"
        add constraint "product_feed_taxonomy_checks_taxonomy_fk"
        foreign key ("installed_taxonomy_id") references "product_feed_taxonomies" ("id")
        on update cascade on delete set null;
    `);
    this.addSql(
      `create index "product_feed_taxonomy_checks_provider_started_idx" on "product_feed_taxonomy_checks" ("provider_code", "started_at" desc);`,
    );
    // The overlap refusal (FR-096) reads exactly this predicate.
    this.addSql(
      `create index "product_feed_taxonomy_checks_in_flight_idx" on "product_feed_taxonomy_checks" ("provider_code") where "finished_at" is null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "product_feed_taxonomy_checks" cascade;`);
    this.addSql(`drop index if exists "product_feed_taxonomies_provider_installed_idx";`);
    this.addSql(`drop index if exists "product_feed_taxonomies_content_hash_uq";`);
    this.addSql(`
      alter table "product_feed_taxonomies"
        drop column if exists "source",
        drop column if exists "source_urls",
        drop column if exists "source_content_hash",
        drop column if exists "source_etag",
        drop column if exists "fetched_at",
        drop column if exists "promoted_at",
        drop column if exists "superseded_at",
        drop column if exists "flags";
    `);
  }
}
