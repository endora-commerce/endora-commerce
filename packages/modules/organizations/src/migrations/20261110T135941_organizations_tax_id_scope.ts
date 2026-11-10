import { Migration } from '@mikro-orm/migrations';

/**
 * `specs/177-tax-id-scope/` (data-model §1–§3 M2) — what the tax-ID scope
 * stands on.
 *
 * - `btree_gist` — the `per-tree-root` exclusion constraint mixes `=` on a
 *   `varchar` with `<>` on a `uuid`. `catalog` creates it too; this module
 *   cannot depend on `catalog` for ordering, so it asks for it itself.
 * - `root_id` — a stored generated column, the first segment of `path` (the
 *   tree's root; `null` only for an empty path, which no stored row has). The
 *   entity does not map it (research R-2). **Lock cost:** adding a stored
 *   generated column rewrites `organizations` under `ACCESS EXCLUSIVE` for the
 *   duration — the upgrade note repeats this.
 * - `organization_tax_id_policy` — the installation's scope, one row, seeded
 *   `global`.
 *
 * It does **not** add `organizations_tax_id_one_tree`: a fresh and an upgraded
 * database both start in `global` (FR-010), and only the
 * `organization.tax_id_scope.set` Command swaps the constraints. So migrations
 * never depend on the scope. **A later migration naming
 * `organizations_tax_id_unique` or `organizations_tax_id_one_tree` must branch on
 * `organization_tax_id_policy.scope`** — `tax-id-scope-migration-guard.test.ts`
 * refuses one that does not.
 *
 * Every table touched is this module's own. Repeatable: `if not exists`
 * throughout.
 *
 * `down()` refuses while the policy says `per-tree-root` — the exclusion
 * constraint stands on `root_id`, and dropping it would leave shared tax IDs
 * under no rule. Otherwise it drops the table, the index and the column; the
 * extension stays (`catalog` uses it).
 *
 * Registration is a regeneration: `pnpm --filter backend run composer:generate`.
 */
export class Migration20261110T135941OrganizationsTaxIdScope extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create extension if not exists btree_gist;`);
    this.addSql(`
      alter table "organizations"
        add column if not exists "root_id" uuid
        generated always as (nullif(split_part("path", '/', 2), '')::uuid) stored;
    `);
    this.addSql(
      `create index if not exists "organizations_root_id_idx" on "organizations" ("root_id");`,
    );
    this.addSql(`
      create table if not exists "organization_tax_id_policy" (
        "id" boolean primary key default true check ("id"),
        "scope" text not null check ("scope" in ('global', 'per-tree-root')),
        "updated_at" timestamptz not null default now(),
        "updated_by_admin_user_id" uuid null
      );
    `);
    this.addSql(`
      insert into "organization_tax_id_policy" ("id", "scope", "updated_at", "updated_by_admin_user_id")
      values (true, 'global', now(), null)
      on conflict do nothing;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      do $$
      begin
        if to_regclass('organization_tax_id_policy') is not null
           and exists (select 1 from "organization_tax_id_policy" where "scope" = 'per-tree-root') then
          raise exception 'organizations: the tax-ID scope is per-tree-root; set it back to global (Organizations → Tax-ID scope) before reverting this migration';
        end if;
      end
      $$;
    `);
    this.addSql(`drop table if exists "organization_tax_id_policy";`);
    this.addSql(`drop index if exists "organizations_root_id_idx";`);
    this.addSql(`alter table "organizations" drop column if exists "root_id";`);
  }
}
