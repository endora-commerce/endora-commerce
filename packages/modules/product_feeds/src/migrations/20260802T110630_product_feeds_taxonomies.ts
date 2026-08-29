import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 067 — provider taxonomies and category mappings (data-model §§8–10).
 *
 * Creates:
 *  - `product_feed_taxonomies` — one bundled provider taxonomy at one revision.
 *    The partial unique index on `provider_code where is_current` is the same
 *    idiom `sales_channels.system_default` uses: exactly one current revision
 *    per provider, enforced by the database rather than by care.
 *  - `product_feed_taxonomy_nodes` — ~10 100 rows across both providers, with
 *    labels and full paths as per-language JSONB maps (one row per node, not
 *    one per node-and-language).
 *  - `product_feed_taxonomy_mappings` — the operator's decisions, one
 *    installation-wide set per provider (FR-081).
 *
 * Also fills in the last piece of the template surface: `product_feed_templates`
 * gained a `taxonomy_id` column in the init migration but could not carry its
 * foreign key, because the target table did not exist yet.
 *
 * Two indexes are worth explaining:
 *  - a GIN trigram index on the localized `full_path` text, so the admin's
 *    typeahead stays under the 100 ms p95 target over ~10 100 rows without a
 *    sequential scan per keystroke;
 *  - a partial index on `stale` — the review list (FR-085) reads only the true
 *    rows, and in a healthy installation there are none.
 */
export class Migration20260802T110630ProductFeedsTaxonomies extends Migration {
  override async up(): Promise<void> {
    // `pg_trgm` powers the node typeahead. Created if absent; on a managed
    // Postgres without the extension available the search still works, only
    // via a sequential scan, so the failure mode is slow rather than broken.
    this.addSql(`create extension if not exists "pg_trgm";`);

    this.addSql(`
      create table "product_feed_taxonomies" (
        "id" uuid not null,
        "provider_code" varchar(32) not null,
        "revision" varchar(32) not null,
        "is_current" boolean not null default false,
        "node_count" int not null default 0,
        "installed_at" timestamptz not null,
        "created_at" timestamptz not null,
        constraint "product_feed_taxonomies_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `create unique index "product_feed_taxonomies_provider_revision_uq" on "product_feed_taxonomies" ("provider_code", "revision");`,
    );
    this.addSql(
      `create unique index "product_feed_taxonomies_current_uq" on "product_feed_taxonomies" ("provider_code") where "is_current" = true;`,
    );

    this.addSql(`
      create table "product_feed_taxonomy_nodes" (
        "id" uuid not null,
        "taxonomy_id" uuid not null,
        "external_id" varchar(32) not null,
        "parent_external_id" varchar(32) null,
        "label" jsonb not null default '{}',
        "full_path" jsonb not null default '{}',
        "depth" int not null default 0,
        "created_at" timestamptz not null,
        constraint "product_feed_taxonomy_nodes_pkey" primary key ("id"),
        constraint "product_feed_taxonomy_nodes_taxonomy_fk"
          foreign key ("taxonomy_id") references "product_feed_taxonomies" ("id")
          on update cascade on delete cascade
      );
    `);
    this.addSql(
      `create unique index "product_feed_taxonomy_nodes_external_uq" on "product_feed_taxonomy_nodes" ("taxonomy_id", "external_id");`,
    );
    this.addSql(
      `create index "product_feed_taxonomy_nodes_parent_idx" on "product_feed_taxonomy_nodes" ("taxonomy_id", "parent_external_id");`,
    );
    this.addSql(
      `create index "product_feed_taxonomy_nodes_path_trgm_idx" on "product_feed_taxonomy_nodes" using gin (("full_path"::text) gin_trgm_ops);`,
    );

    this.addSql(`
      create table "product_feed_taxonomy_mappings" (
        "id" uuid not null,
        "taxonomy_provider_code" varchar(32) not null,
        "category_id" uuid not null,
        "node_external_id" varchar(32) not null,
        "stale" boolean not null default false,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "product_feed_taxonomy_mappings_pkey" primary key ("id"),
        constraint "product_feed_taxonomy_mappings_category_fk"
          foreign key ("category_id") references "categories" ("id")
          on update cascade on delete cascade
      );
    `);
    this.addSql(
      `create unique index "product_feed_taxonomy_mappings_uq" on "product_feed_taxonomy_mappings" ("taxonomy_provider_code", "category_id");`,
    );
    this.addSql(
      `create index "product_feed_taxonomy_mappings_stale_idx" on "product_feed_taxonomy_mappings" ("taxonomy_provider_code") where "stale" = true;`,
    );

    // The deferred pointer from the init migration. `on delete set null`: an
    // uninstalled taxonomy must not take a template with it.
    this.addSql(`
      alter table "product_feed_templates"
        add constraint "product_feed_templates_taxonomy_fk"
        foreign key ("taxonomy_id") references "product_feed_taxonomies" ("id")
        on update cascade on delete set null;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "product_feed_templates" drop constraint if exists "product_feed_templates_taxonomy_fk";`,
    );
    this.addSql(`drop table if exists "product_feed_taxonomy_mappings" cascade;`);
    this.addSql(`drop table if exists "product_feed_taxonomy_nodes" cascade;`);
    this.addSql(`drop table if exists "product_feed_taxonomies" cascade;`);
  }
}
