import { Migration } from '@mikro-orm/migrations';

/**
 * Sales Channels module — feature 005 / data-model.md.
 *
 * The `sales_channels` table itself was created back in foundation 001;
 * this migration promotes it from a thin catalog-owned record into the
 * full Sales-Channel registry the spec describes:
 *
 *   - Adds the missing identity columns (`logo_asset_id`, `theme_code`,
 *     `languages` jsonb, `currencies` jsonb, `active`, `system_default`,
 *     `version`) and the partial unique index that enforces the
 *     "exactly-one system default" invariant (FR-002).
 *   - Backfills the new jsonb arrays from the existing scalar
 *     `default_language` / `default_currency` columns and copies
 *     `status='active'` into the new boolean `active` flag.
 *
 * It also added a NULLABLE `sales_channel_id` column to `quote_requests`
 * (FR-006) until `specs/120-migration-closure-bridge-ownership/` Phase 3. That
 * column, its `ON DELETE RESTRICT` foreign key and its index are now
 * `Migration20260912T125614QuoteRequestsQuoteRequestChannelAttribution`'s,
 * under the same rule as the bridges below: the platform declares no
 * dependencies, so it can never be ordered after a module's table, and
 * `quote_requests` is not the platform's. The column is still NULLABLE and
 * T060 (US3) still owns the backfill and the NOT NULL flip.
 *
 * It created eight M:N sales-channel bridge tables (FR-009) until
 * `specs/120-migration-closure-bridge-ownership/` Phase 2. Each one now belongs
 * to the module that owns its far side, under D-226's ownership rule: a bridge
 * between an always-present near side and a switchable far side is the far
 * side's. The class name and every statement below it are unchanged, so a
 * database that already applied this migration is offered nothing — the storage
 * keys on the class name and holds no checksum — and the eight far-side
 * migrations are `create table if not exists` no-ops on it. On a fresh database
 * they create the same eight tables from the same statements, later in the
 * order, which is where they have to be for an instance that omits one of those
 * modules to migrate at all.
 *
 * Deferred (intentionally NOT in this migration):
 *
 *   - `sales_channel_inventory_locations` — the inventory module does
 *     not yet have an `inventory_locations` table. The bridge will be
 *     added in the same migration that introduces that table; until
 *     then, FR-009's "Inventory" item is unimplemented and is tracked
 *     by tasks.md T054 / data-model.md § Entities note.
 *   - The legacy `is_public` and `status` columns are kept as-is for
 *     one release cycle (R-12) so this migration is fully reversible.
 *     A later cleanup migration will drop them once every consumer has
 *     moved to `active`.
 *   - Inserting / promoting the `Default` row — the boot-time
 *     reconciler (`default-channel-reconciler.ts`) is the single source
 *     of truth (R-4).
 *
 * The down() reverses every up() step; the legacy columns are not
 * touched. It no longer drops the eight bridge tables, nor the
 * `quote_requests` column, because this migration no longer creates either —
 * each migration that took a statement drops its own.
 *
 * Filed under `core` since feature 072 T020. The kernel owns the tables this
 * migration writes to, and a hard uninstall reverts by registry `moduleId`, so
 * leaving it under `sales_channels` made `modules:uninstall --hard sales_channels` drop
 * kernel schema.
 */
export class Migration20260430T170044CoreSalesChannelsPromote extends Migration {
  override async up(): Promise<void> {
    // -- 1. Identity columns ------------------------------------------------
    this.addSql(
      'alter table "sales_channels" add column "logo_asset_id" uuid null;',
    );
    this.addSql(
      'alter table "sales_channels" add constraint "sales_channels_logo_asset_fk" ' +
        'foreign key ("logo_asset_id") references "assets" ("id") on delete set null;',
    );
    this.addSql(
      'alter table "sales_channels" add column "theme_code" varchar(64) null;',
    );
    this.addSql(
      'alter table "sales_channels" add column "languages" jsonb not null default \'[]\'::jsonb;',
    );
    this.addSql(
      'alter table "sales_channels" add column "currencies" jsonb not null default \'[]\'::jsonb;',
    );
    this.addSql(
      'alter table "sales_channels" add column "active" boolean not null default true;',
    );
    this.addSql(
      'alter table "sales_channels" add column "system_default" boolean not null default false;',
    );
    this.addSql(
      'alter table "sales_channels" add column "version" int not null default 1;',
    );

    // -- 2. Backfills (data-only; safe and idempotent) ----------------------
    // Seed the new jsonb arrays from the existing scalar defaults.
    this.addSql(
      'update "sales_channels" set "languages" = jsonb_build_array("default_language") ' +
        "where jsonb_array_length(\"languages\") = 0;",
    );
    this.addSql(
      'update "sales_channels" set "currencies" = jsonb_build_array("default_currency") ' +
        "where jsonb_array_length(\"currencies\") = 0;",
    );
    // Mirror legacy `status='active'` into the new boolean.
    this.addSql(
      "update \"sales_channels\" set \"active\" = (\"status\" = 'active');",
    );

    // -- 3. Partial unique index (FR-002) -----------------------------------
    this.addSql(
      'create unique index "sales_channels_one_system_default" ' +
        'on "sales_channels" ("system_default") where "system_default" = true;',
    );
  }

  override async down(): Promise<void> {
    // 3. Partial unique index
    this.addSql('drop index if exists "sales_channels_one_system_default";');

    // 1. Identity columns
    this.addSql('alter table "sales_channels" drop column if exists "version";');
    this.addSql('alter table "sales_channels" drop column if exists "system_default";');
    this.addSql('alter table "sales_channels" drop column if exists "active";');
    this.addSql('alter table "sales_channels" drop column if exists "currencies";');
    this.addSql('alter table "sales_channels" drop column if exists "languages";');
    this.addSql('alter table "sales_channels" drop column if exists "theme_code";');
    this.addSql(
      'alter table "sales_channels" drop constraint if exists "sales_channels_logo_asset_fk";',
    );
    this.addSql('alter table "sales_channels" drop column if exists "logo_asset_id";');
  }
}
