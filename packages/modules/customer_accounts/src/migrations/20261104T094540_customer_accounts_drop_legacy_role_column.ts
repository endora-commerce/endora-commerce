import { Migration } from '@mikro-orm/migrations';

/**
 * Drops `customer_accounts.role` — migration **M5** of
 * `specs/170-organization-roles/` (`contracts/migration-and-replay.md` §4;
 * data-model §5; research R-23, R-28; owner ruling PR-3; FR-073, FR-074).
 *
 * 1. Redefines M3's `customer_accounts_default_organization_role` without its
 *    legacy branch: an account inserted without a role reference holds
 *    *Administrator* in a personal Organization (PR-3), else *Member*. It must
 *    come first — the function names `new.role`, which stops existing below.
 * 2. Drops the column; its index (`customer_accounts_role_index`) goes with it,
 *    and is dropped by name first so the statement says so.
 *
 * Repeatable (FR-074): `create or replace`, `if exists`.
 *
 * `down()` restores the previous schema exactly — the column with its old type
 * and default, the index, M3's function — and **re-derives** the value from the
 * role reference, so the upgrade replay's round trip is exact (§6): an account
 * holding its Organization's *Administrator* is `organization_admin`, any other
 * `regular_user`. A personal Organization's account therefore comes back as
 * `organization_admin`, not the `regular_user` it may have held before M3 (§4).
 *
 * Reads `organization_roles` and `organizations` — covered by the declared
 * dependency on `organizations`, as M3's reads are; writes only this module's
 * `customer_accounts`.
 *
 * Registration is a regeneration: `pnpm --filter backend run composer:generate`.
 */
export class Migration20261104T094540CustomerAccountsDropLegacyRoleColumn extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create or replace function "customer_accounts_default_organization_role"() returns trigger
      language plpgsql as $$
      begin
        select r."id" into new."organization_role_id"
          from "organization_roles" r
          join "organizations" o on o."id" = r."organization_id"
         where r."organization_id" = new."organization_id"
           and r."kind" = case when o."is_personal" then 'administrator' else 'member' end;
        return new;
      end
      $$;
    `);
    this.addSql(`drop index if exists "customer_accounts_role_index";`);
    this.addSql(`alter table "customer_accounts" drop column if exists "role";`);
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "customer_accounts" add column if not exists "role" varchar(32) not null default 'regular_user';`,
    );
    this.addSql(`
      update "customer_accounts" a
         set "role" = 'organization_admin'
        from "organization_roles" r
       where r."id" = a."organization_role_id"
         and r."organization_id" = a."organization_id"
         and r."kind" = 'administrator';
    `);
    this.addSql(
      `create index if not exists "customer_accounts_role_index" on "customer_accounts" ("role");`,
    );

    // M3's default, as M3 installs it.
    this.addSql(`
      create or replace function "customer_accounts_default_organization_role"() returns trigger
      language plpgsql as $$
      begin
        select r."id" into new."organization_role_id"
          from "organization_roles" r
          join "organizations" o on o."id" = r."organization_id"
         where r."organization_id" = new."organization_id"
           and r."kind" = case
                 when o."is_personal" or new."role" = 'organization_admin' then 'administrator'
                 else 'member'
               end;
        return new;
      end
      $$;
    `);
  }
}
