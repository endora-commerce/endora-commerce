import { Migration } from '@mikro-orm/migrations';

/**
 * Organization roles — migration **M2** of `specs/170-organization-roles/`
 * (`contracts/migration-and-replay.md` §2; data-model §1 and §3; research
 * R-18, R-19, R-28; owner ruling PR-2; FR-001, FR-070, FR-071, FR-074).
 *
 * 1. Creates `organization_roles`: `administrator`, `member` and `custom` rows,
 *    exactly one of each predefined kind per Organization, custom names unique
 *    per Organization after `lower(btrim(…))`, and `unique (organization_id, id)`
 *    as the target of the composite foreign keys that make a cross-Organization
 *    assignment impossible in the database itself (FR-005).
 * 2. Inserts both predefined rows for **every** Organization — company,
 *    personal, suspended — that lacks them (FR-001, FR-070), with empty arrays:
 *    by research R-17 a *Member* holds every member-default code it has not been
 *    offered, so an empty row is already correct.
 * 3. Writes FR-071's exception as data (R-18): in an Organization that required
 *    cart approval, *Member* has already been "offered" the two codes approval
 *    withheld, so it does not hold them. This migration names two codes owned by
 *    `carts` and `quick_order` — accepted and bounded by R-18: it translates
 *    **this module's own** column into **this module's own** table, once.
 * 4. Installs the R-28 `after insert on organizations` trigger, so every future
 *    Organization gets both rows in its own insert, whichever path creates it.
 * 5. Gives `organization_invitations` its `organization_role_id`, backfilled from
 *    the legacy `role` for every invitation — pending, expired, revoked and
 *    accepted (FR-070) — then `not null` and the composite foreign key
 *    (`on delete restrict`: a role an invitation names cannot be deleted).
 * 6. Installs a `before insert` trigger on `organization_invitations` that fills
 *    a missing `organization_role_id` from `new.role`. The production path always
 *    passes the id (the invitation service dual-writes both); the trigger is the
 *    invitations' twin of M3's account default (R-28), for the raw inserts that
 *    name only the legacy column — the frozen WP-00 oracle among them. It goes
 *    with `role` (migration M4).
 *
 * Repeatable (FR-074): `if not exists`, `where not exists`, `where … is null`,
 * `create or replace`, and constraints added only when absent. `down()` restores
 * the previous schema exactly — the replay of R-27 depends on it — and loses the
 * role data, which before this migration did not exist.
 *
 * Every table touched is this module's own: `organizations`,
 * `organization_invitations` and the new `organization_roles`.
 *
 * Registration is a regeneration: `pnpm --filter backend run composer:generate`.
 */
export class Migration20261103T173304OrganizationsOrganizationRoles extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table if not exists "organization_roles" (
        "id" uuid not null,
        "organization_id" uuid not null,
        "kind" text not null,
        "name" varchar(80) null,
        "name_normalized" varchar(80) null,
        "description" varchar(500) null,
        "permissions" text[] not null default '{}',
        "member_defaults_offered" text[] not null default '{}',
        "version" integer not null default 1,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "organization_roles_pkey" primary key ("id"),
        constraint "organization_roles_organization_fk" foreign key ("organization_id")
          references "organizations" ("id") on delete cascade,
        constraint "organization_roles_organization_id_id_unique" unique ("organization_id", "id"),
        constraint "organization_roles_kind_check" check ("kind" in ('administrator', 'member', 'custom')),
        constraint "organization_roles_name_check" check (("kind" = 'custom') = ("name" is not null)),
        constraint "organization_roles_name_normalized_check"
          check (("kind" = 'custom') = ("name_normalized" is not null))
      );
    `);
    this.addSql(
      `create index if not exists "organization_roles_organization_id_index" on "organization_roles" ("organization_id");`,
    );
    this.addSql(
      `create unique index if not exists "organization_roles_one_administrator" on "organization_roles" ("organization_id") where "kind" = 'administrator';`,
    );
    this.addSql(
      `create unique index if not exists "organization_roles_one_member" on "organization_roles" ("organization_id") where "kind" = 'member';`,
    );
    this.addSql(
      `create unique index if not exists "organization_roles_custom_name_unique" on "organization_roles" ("organization_id", "name_normalized") where "kind" = 'custom';`,
    );

    // FR-001 / FR-070 — both predefined roles for every Organization.
    this.addSql(`
      insert into "organization_roles"
        ("id", "organization_id", "kind", "permissions", "member_defaults_offered", "version", "created_at", "updated_at")
      select gen_random_uuid(), o."id", k."kind", '{}', '{}', 1, now(), now()
        from "organizations" o
       cross join (values ('administrator'), ('member')) as k("kind")
       where not exists (
         select 1 from "organization_roles" r where r."organization_id" = o."id" and r."kind" = k."kind"
       );
    `);

    // FR-071 / R-18 — an approval-requiring Organization's Member was "offered" both codes.
    // Guarded by the column's presence: migration M4 drops it, and a re-run of
    // this `up()` after M4 (FR-074, the replay's step 7) has nothing to map.
    this.addSql(`
      do $$
      begin
        if exists (
          select 1 from information_schema.columns
           where table_schema = current_schema() and table_name = 'organizations'
             and column_name = 'requires_cart_approval'
        ) then
          execute $sql$
            update "organization_roles" r
               set "member_defaults_offered" = array['carts.order_without_approval', 'quick_order.one_click']
              from "organizations" o
             where r."organization_id" = o."id"
               and r."kind" = 'member'
               and o."requires_cart_approval" = true
               and r."member_defaults_offered" = '{}'
          $sql$;
        end if;
      end
      $$;
    `);

    // R-28 — every future Organization gets both rows in its own insert.
    this.addSql(`
      create or replace function "organizations_seed_predefined_roles"() returns trigger
      language plpgsql as $$
      begin
        insert into "organization_roles"
          ("id", "organization_id", "kind", "permissions", "member_defaults_offered", "version", "created_at", "updated_at")
        values (gen_random_uuid(), new."id", 'administrator', '{}', '{}', 1, now(), now()),
               (gen_random_uuid(), new."id", 'member', '{}', '{}', 1, now(), now())
        on conflict do nothing;
        return new;
      end
      $$;
    `);
    this.addSql(`drop trigger if exists "organizations_seed_predefined_roles" on "organizations";`);
    this.addSql(`
      create trigger "organizations_seed_predefined_roles" after insert on "organizations"
        for each row execute function "organizations_seed_predefined_roles"();
    `);

    // Invitations — the role reference, every row (FR-070).
    this.addSql(
      `alter table "organization_invitations" add column if not exists "organization_role_id" uuid null;`,
    );
    // Guarded like the marker above: M4 drops `role`, after which every
    // invitation already names its role.
    this.addSql(`
      do $$
      begin
        if exists (
          select 1 from information_schema.columns
           where table_schema = current_schema() and table_name = 'organization_invitations'
             and column_name = 'role'
        ) then
          execute $sql$
            update "organization_invitations" i
               set "organization_role_id" = r."id"
              from "organization_roles" r
             where r."organization_id" = i."organization_id"
               and r."kind" = case when i."role" = 'organization_admin' then 'administrator' else 'member' end
               and i."organization_role_id" is null
          $sql$;
        end if;
      end
      $$;
    `);
    this.addSql(
      `alter table "organization_invitations" alter column "organization_role_id" set not null;`,
    );
    this.addSql(`
      do $$
      begin
        if not exists (
          select 1 from pg_constraint where conname = 'organization_invitations_organization_role_fk'
        ) then
          alter table "organization_invitations"
            add constraint "organization_invitations_organization_role_fk"
            foreign key ("organization_id", "organization_role_id")
            references "organization_roles" ("organization_id", "id") on delete restrict;
        end if;
      end
      $$;
    `);
    this.addSql(
      `create index if not exists "organization_invitations_organization_role_index" on "organization_invitations" ("organization_id", "organization_role_id");`,
    );

    // The invitations' default, for a raw insert naming only the legacy role.
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

  override async down(): Promise<void> {
    this.addSql(
      `drop trigger if exists "organization_invitations_default_role" on "organization_invitations";`,
    );
    this.addSql(`drop function if exists "organization_invitations_default_role"();`);
    this.addSql(
      `alter table "organization_invitations" drop constraint if exists "organization_invitations_organization_role_fk";`,
    );
    this.addSql(`drop index if exists "organization_invitations_organization_role_index";`);
    this.addSql(`alter table "organization_invitations" drop column if exists "organization_role_id";`);
    this.addSql(`drop trigger if exists "organizations_seed_predefined_roles" on "organizations";`);
    this.addSql(`drop function if exists "organizations_seed_predefined_roles"();`);
    this.addSql(`drop table if exists "organization_roles";`);
  }
}
