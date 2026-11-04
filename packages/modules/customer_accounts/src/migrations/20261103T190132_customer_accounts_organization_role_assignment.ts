import { Migration } from '@mikro-orm/migrations';

/**
 * Organization role assignment — migration **M3** of
 * `specs/170-organization-roles/` (`contracts/migration-and-replay.md` §3;
 * data-model §2; research R-19, R-23, R-28, R-34; owner rulings PR-2, PR-3;
 * FR-006, FR-070, FR-074).
 *
 * 1. Adds `customer_accounts.organization_role_id` and backfills it for
 *    **every** account — blocked and soft-deleted ones included (FR-070) — from
 *    the legacy `role`: `organization_admin` → the Organization's
 *    *Administrator*, else its *Member*. Every account of a **personal**
 *    Organization holds *Administrator* whatever its `role` (owner ruling PR-3,
 *    research R-34). The legacy `role` is **not** rewritten: it stays as it was
 *    until migration M5 drops it, so this migration's `down()` loses nothing.
 * 2. Makes it `not null` and adds the composite foreign key
 *    `(organization_id, organization_role_id)` → `organization_roles
 *    (organization_id, id)` `on delete restrict`: an account can hold only a
 *    role of its own Organization (FR-005), and a role an account holds cannot
 *    be deleted (FR-024).
 * 3. Installs the R-28 `before insert` trigger: an account inserted without a
 *    role reference gets *Administrator* in a personal Organization, else the
 *    role its legacy `role` names, else *Member* (owner ruling PR-2). Production
 *    paths always pass the id — the write ports require it — so the trigger is
 *    the database's statement of the entity's default, for the fixtures that
 *    create an account directly. M5 redefines it without the `role` branch.
 *
 * Reads `organizations` and `organization_roles` — a cross-module read covered
 * by the declared dependency on `organizations` (R1 of
 * `specs/097-migration-sql-boundary/contracts/migration-cross-module-sql.md`);
 * writes only this module's `customer_accounts` (R2). `organizations` runs
 * first, so `organization_roles` (migration M2) exists.
 *
 * Repeatable (FR-074): `if not exists`, `where … is null`, `create or replace`,
 * and the constraint added only when absent. `down()` restores the previous
 * schema exactly — the replay of R-27 depends on it.
 *
 * Registration is a regeneration: `pnpm --filter backend run composer:generate`.
 */
export class Migration20261103T190132CustomerAccountsOrganizationRoleAssignment extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "customer_accounts" add column if not exists "organization_role_id" uuid null;`,
    );

    // FR-070 / PR-3 — every account, deleted and blocked included. Guarded by
    // the column's presence: migration M5 drops `role`, after which every
    // account already holds a role, so a re-run (FR-074) has nothing to map.
    this.addSql(`
      do $$
      begin
        if exists (
          select 1 from information_schema.columns
           where table_schema = current_schema() and table_name = 'customer_accounts'
             and column_name = 'role'
        ) then
          execute $sql$
            update "customer_accounts" a
               set "organization_role_id" = r."id"
              from "organization_roles" r, "organizations" o
             where o."id" = a."organization_id"
               and r."organization_id" = a."organization_id"
               and r."kind" = case
                     when o."is_personal" or a."role" = 'organization_admin' then 'administrator'
                     else 'member'
                   end
               and a."organization_role_id" is null
          $sql$;
        end if;
      end
      $$;
    `);
    this.addSql(`alter table "customer_accounts" alter column "organization_role_id" set not null;`);
    this.addSql(`
      do $$
      begin
        if not exists (
          select 1 from pg_constraint where conname = 'customer_accounts_organization_role_fk'
        ) then
          alter table "customer_accounts"
            add constraint "customer_accounts_organization_role_fk"
            foreign key ("organization_id", "organization_role_id")
            references "organization_roles" ("organization_id", "id") on delete restrict;
        end if;
      end
      $$;
    `);
    this.addSql(
      `create index if not exists "customer_accounts_organization_role_index" on "customer_accounts" ("organization_id", "organization_role_id");`,
    );

    // R-28 / PR-2, PR-3 — the default for an account inserted without a role.
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
    this.addSql(
      `drop trigger if exists "customer_accounts_default_organization_role" on "customer_accounts";`,
    );
    this.addSql(`
      create trigger "customer_accounts_default_organization_role" before insert on "customer_accounts"
        for each row when (new."organization_role_id" is null)
        execute function "customer_accounts_default_organization_role"();
    `);
  }

  override async down(): Promise<void> {
    this.addSql(
      `drop trigger if exists "customer_accounts_default_organization_role" on "customer_accounts";`,
    );
    this.addSql(`drop function if exists "customer_accounts_default_organization_role"();`);
    this.addSql(
      `alter table "customer_accounts" drop constraint if exists "customer_accounts_organization_role_fk";`,
    );
    this.addSql(`drop index if exists "customer_accounts_organization_role_index";`);
    this.addSql(`alter table "customer_accounts" drop column if exists "organization_role_id";`);
  }
}
