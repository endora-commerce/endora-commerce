import { Migration } from '@mikro-orm/migrations';

/**
 * Saved views on the admin Opportunities page (issue #1734, the rules of
 * `specs/147-saved-views/`) — one row per named preset of the page's filters
 * and sort, owned by an admin user and optionally shared with every admin who
 * may read CRM. One view serves the list and the board.
 *
 * No foreign key to `admin_users`: a view outlives its owner's access and its
 * owner, as every other list's views do, and the reference would be a
 * cross-module one. `sort` is nullable: `null` means the list's default order.
 * There is no `visible_columns`: the list has no column picker.
 *
 * The unique expression index is the duplicate-name rule held by the schema:
 * one owner has no two views whose names share `lower(name)`. Names are stored
 * trimmed by the service, so `lower(name)` is the same key the service probes
 * with `lower(btrim(name))`. The index leads with the owner, so it also serves
 * the owner lookup and no separate owner index is created.
 *
 * Switching `crm` off leaves these rows untouched.
 */
export class Migration20261122T074243CrmOpportunityListSavedViews extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "crm_opportunity_list_saved_views" (
        "id" uuid not null,
        "owner_admin_user_id" uuid not null,
        "name" varchar(160) not null,
        "shared" boolean not null default false,
        "filters" jsonb not null default '{}'::jsonb,
        "sort" jsonb null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "crm_opportunity_list_saved_views_pkey" primary key ("id"),
        constraint "crm_opportunity_list_saved_views_filters_size_check" check (octet_length("filters"::text) <= 8192)
      );
    `);
    this.addSql(
      `create unique index "crm_opportunity_list_saved_views_owner_name_key_uq" on "crm_opportunity_list_saved_views" ("owner_admin_user_id", lower("name"));`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "crm_opportunity_list_saved_views";`);
  }
}
