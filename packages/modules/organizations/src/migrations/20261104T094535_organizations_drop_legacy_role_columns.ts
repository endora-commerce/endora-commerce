import { Migration } from '@mikro-orm/migrations';

/**
 * Drops the legacy role columns of `organizations` — migration **M4** of
 * `specs/170-organization-roles/` (`contracts/migration-and-replay.md` §4;
 * data-model §5; research R-23; FR-073, FR-074).
 *
 * 1. `organizations.requires_cart_approval` — replaced by the
 *    `carts.order_without_approval` organization permission (OR-3). M2 read it
 *    last, to withhold that code from an approval-requiring Organization's
 *    *Member* (FR-071); nothing reads it since.
 * 2. `organization_invitations.role` — replaced by `organization_role_id` (M2).
 *    M2's `organization_invitations_default_role` trigger filled a missing
 *    reference from it, so the trigger and its function go first.
 *
 * Repeatable (FR-074): `if exists` throughout.
 *
 * `down()` restores the previous schema exactly — each column with its old type
 * and default, M2's trigger with it — and **re-derives** the values from the role
 * reference, so the upgrade replay's down-then-up round trip is exact (§6):
 * an invitation naming the Organization's *Administrator* is `organization_admin`,
 * any other `regular_user`; an Organization requires cart approval exactly when
 * its *Member* lacks `carts.order_without_approval` — offered (R-17) and not
 * granted back. The code is named here as M2 names it, and for the same reason
 * (R-18): it translates this module's own table back into this module's own column.
 *
 * Every table touched is this module's own. `requires_cart_approval` was added by
 * `carts`' consolidation migration, which belongs to the frozen historical
 * prefix and therefore always runs before this one.
 *
 * Registration is a regeneration: `pnpm --filter backend run composer:generate`.
 */
export class Migration20261104T094535OrganizationsDropLegacyRoleColumns extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `drop trigger if exists "organization_invitations_default_role" on "organization_invitations";`,
    );
    this.addSql(`drop function if exists "organization_invitations_default_role"();`);
    this.addSql(`alter table "organization_invitations" drop column if exists "role";`);
    this.addSql(`alter table "organizations" drop column if exists "requires_cart_approval";`);
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "organizations" add column if not exists "requires_cart_approval" boolean not null default false;`,
    );
    this.addSql(`
      update "organizations" o
         set "requires_cart_approval" = true
        from "organization_roles" r
       where r."organization_id" = o."id"
         and r."kind" = 'member'
         and 'carts.order_without_approval' = any(r."member_defaults_offered")
         and not ('carts.order_without_approval' = any(r."permissions"));
    `);

    this.addSql(
      `alter table "organization_invitations" add column if not exists "role" varchar(32) not null default 'regular_user';`,
    );
    this.addSql(`
      update "organization_invitations" i
         set "role" = 'organization_admin'
        from "organization_roles" r
       where r."id" = i."organization_role_id"
         and r."organization_id" = i."organization_id"
         and r."kind" = 'administrator';
    `);

    // M2's default, as M2 installs it.
    this.addSql(`
      create or replace function "organization_invitations_default_role"() returns trigger
      language plpgsql as $$
      begin
        select r."id" into new."organization_role_id"
          from "organization_roles" r
         where r."organization_id" = new."organization_id"
           and r."kind" = case when new."role" = 'organization_admin' then 'administrator' else 'member' end;
        return new;
      end
      $$;
    `);
    this.addSql(
      `drop trigger if exists "organization_invitations_default_role" on "organization_invitations";`,
    );
    this.addSql(`
      create trigger "organization_invitations_default_role" before insert on "organization_invitations"
        for each row when (new."organization_role_id" is null)
        execute function "organization_invitations_default_role"();
    `);
  }
}
