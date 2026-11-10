import { Migration } from '@mikro-orm/migrations';

/**
 * Issue #955 (design D5.1 of `specs/175-sales-rep-reach-rule/plan.md`): the
 * materialised `organization_reach_governor` table, so a roll-up sales
 * representative's reach is one scan of a table instead of a path probe per
 * governing organization.
 *
 * ## What a row says
 *
 * `(organization_id, governor_id)`: the nearest ancestor-or-self of the
 * organization that carries an assignment row — the node that decides who sees
 * it under roll-up (FR-011, "nearest assignment wins"). An organization with no
 * such node has **no row**: it is governed by nobody and is in every
 * representative's reach.
 *
 * The chain is the one `SalesRepAssignmentService.canSeeOrganization` walks:
 * the organization itself, then the ancestors its **own** stored path names,
 * nearest first. A path `isReadableTreePath` refuses names no ancestor, so such
 * an organization is governed by its own rows only. An assignment row whose
 * organization does not exist governs itself, as the one-id rule says it does.
 *
 * ## One function writes it
 *
 * `organizations_reach_governor_rebuild(ids)` recomputes the rows of the given
 * organizations — every row for `null` — from their paths and the assignment
 * table. The backfill below is that function over everything; the maintenance
 * is that function over what a statement touched.
 *
 * ## Maintained in the writing transaction, by every writer
 *
 * A governor row that is missing or stale **widens** reach: an organization
 * another representative governs would read as governed by nobody. So the rows
 * are recomputed inside the transaction of each write that can move them —
 * the assign and unassign of a representative, a move / set-parent (the path
 * rewrite), a create and a delete — by statement-level triggers on the two
 * tables the answer is derived from, rather than by a call each writer has to
 * remember. Assignments are written by the service, by the demo reset and by
 * dozens of fixtures, and organizations by registration, personal-organization
 * provisioning and other modules' migrations; a trigger is the one place none
 * of them can skip (the same reason `organizations_seed_predefined_roles` is a
 * trigger). An organization's governor depends on its own path and on which
 * organizations carry an assignment, and on nothing else, so:
 *
 *  - an assignment written or removed on X recomputes X and every organization
 *    whose path names X (the GIN index on the path's segments finds them);
 *  - an organization inserted, deleted, or whose path changed recomputes that
 *    organization — a move rewrites every moved path in one `update`, so the
 *    whole moved subtree is in that statement's transition table.
 *
 * Every maintenance step takes one transaction-scoped advisory lock before it
 * reads. Two concurrent writes — an assignment on X and a move of D under X —
 * would otherwise each read the other's change as not yet committed and leave
 * D ungoverned. Under the lock the second one waits for the first to commit,
 * and (`READ COMMITTED`, a volatile function) reads it with a fresh snapshot.
 */
export class Migration20261109T144721OrganizationsReachGovernor extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table if not exists "organization_reach_governor" (
        "organization_id" uuid not null,
        "governor_id" uuid not null,
        constraint "organization_reach_governor_pkey" primary key ("organization_id")
      );
    `);
    // The organizations whose stored path names a given organization, for the
    // assignment trigger: `string_to_array(path, '/') && ids`.
    this.addSql(`
      create index if not exists "organizations_path_segments_idx"
        on "organizations" using gin (string_to_array("path", '/'));
    `);

    // `isReadableTreePath`, in SQL: a leading slash, the organization's own id
    // as the last segment, no empty segment, no `LIKE` metacharacter.
    //
    // PL/pgSQL rather than SQL on purpose: a SQL function is inlined, and the
    // inlined expression no longer matches the partial index below, so the
    // planner scanned every organization to answer "which paths are
    // unreadable" (measured: 126 ms of a 130 ms reach at 50 000 organizations).
    // An opaque call matches the index predicate as written.
    this.addSql(`
      create or replace function "organizations_tree_path_readable"(p_path text, p_id uuid)
      returns boolean language plpgsql immutable parallel safe as $$
      begin
        return p_path is not null
           and left(p_path, 1) = '/'
           and right(p_path, 38) = '/' || p_id::text || '/'
           and strpos(p_path, '//') = 0
           and p_path !~ '[%_\\\\]';
      end
      $$;
    `);

    // The organizations whose stored path cannot be read — a data defect the
    // create hook and the repair migration prevent, so normally none. `reachOf`
    // names the governing ones in a `warn` (ruling Q1 on PR #954); this keeps
    // that question an empty index probe rather than a scan.
    this.addSql(`
      create index if not exists "organizations_unreadable_path_idx" on "organizations" ("id")
        where not "organizations_tree_path_readable"("path", "id");
    `);

    this.addSql(`
      create or replace function "organizations_reach_governor_rebuild"(p_ids uuid[])
      returns void language plpgsql as $$
      begin
        if p_ids is null then
          delete from "organization_reach_governor";
        else
          delete from "organization_reach_governor" where "organization_id" = any(p_ids);
        end if;
        insert into "organization_reach_governor" ("organization_id", "governor_id")
        select n."id", g."governor_id"
          from (
            select o."id", o."path"
              from "organizations" o
             where p_ids is null or o."id" = any(p_ids)
            union all
            select distinct a."organization_id", null::text
              from "organization_sales_rep_assignments" a
             where (p_ids is null or a."organization_id" = any(p_ids))
               and not exists (select 1 from "organizations" o where o."id" = a."organization_id")
          ) n
          cross join lateral (
            select hit."organization_id" as "governor_id"
              from unnest(
                     case when "organizations_tree_path_readable"(n."path", n."id")
                          then string_to_array(substr(n."path", 2, length(n."path") - 2), '/')
                          else array[n."id"::text]
                     end
                   ) with ordinality as s("segment", "ord")
              cross join lateral (
                select a."organization_id"
                  from "organization_sales_rep_assignments" a
                 where a."organization_id" = case
                         when s."segment" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                         then s."segment"::uuid
                       end
                 limit 1
              ) hit
             order by s."ord" desc
             limit 1
          ) g;
      end
      $$;
    `);

    this.addSql(`
      create or replace function "organizations_reach_governor_on_assignments"()
      returns trigger language plpgsql as $$
      declare
        v_changed uuid[];
      begin
        if TG_OP = 'INSERT' then
          select array_agg(distinct r."organization_id") into v_changed from "reach_new" r;
        elsif TG_OP = 'DELETE' then
          select array_agg(distinct r."organization_id") into v_changed from "reach_old" r;
        else
          select array_agg(distinct u."id") into v_changed
            from (select "organization_id" as "id" from "reach_new"
                  union select "organization_id" from "reach_old") u;
        end if;
        if v_changed is null then
          return null;
        end if;
        perform pg_advisory_xact_lock(hashtextextended('organizations.reach_governor', 0));
        perform "organizations_reach_governor_rebuild"(
          v_changed || coalesce(
            (select array_agg(o."id") from "organizations" o
              where string_to_array(o."path", '/') && (select array_agg(c::text) from unnest(v_changed) c)),
            '{}'::uuid[]
          )
        );
        return null;
      end
      $$;
    `);
    this.addSql(`
      create or replace function "organizations_reach_governor_on_organizations"()
      returns trigger language plpgsql as $$
      declare
        v_changed uuid[];
      begin
        if TG_OP = 'INSERT' then
          select array_agg(r."id") into v_changed from "reach_new" r;
        elsif TG_OP = 'DELETE' then
          select array_agg(r."id") into v_changed from "reach_old" r;
        else
          select array_agg(coalesce(n."id", o."id")) into v_changed
            from "reach_new" n
            full join "reach_old" o on o."id" = n."id"
           where n."id" is null or o."id" is null or n."path" is distinct from o."path";
        end if;
        if v_changed is null then
          return null;
        end if;
        perform pg_advisory_xact_lock(hashtextextended('organizations.reach_governor', 0));
        perform "organizations_reach_governor_rebuild"(v_changed);
        return null;
      end
      $$;
    `);
    this.addSql(`
      create or replace function "organizations_reach_governor_on_truncate"()
      returns trigger language plpgsql as $$
      begin
        perform pg_advisory_xact_lock(hashtextextended('organizations.reach_governor', 0));
        perform "organizations_reach_governor_rebuild"(null);
        return null;
      end
      $$;
    `);

    for (const [name, table, event, transition] of STATEMENT_TRIGGERS) {
      const fn =
        table === 'organizations'
          ? 'organizations_reach_governor_on_organizations'
          : 'organizations_reach_governor_on_assignments';
      this.addSql(`drop trigger if exists "${name}" on "${table}";`);
      this.addSql(`
        create trigger "${name}" after ${event} on "${table}"
          referencing ${transition}
          for each statement execute function "${fn}"();
      `);
    }
    for (const [name, table] of TRUNCATE_TRIGGERS) {
      this.addSql(`drop trigger if exists "${name}" on "${table}";`);
      this.addSql(`
        create trigger "${name}" after truncate on "${table}"
          for each statement execute function "organizations_reach_governor_on_truncate"();
      `);
    }

    // One representative's reach over the governor table (architect ruling on
    // #955, Q2), defined once: `organizations_reach_split` answers, for every
    // governed organization, whether the representative governs it; flat reads
    // the self-rows — an organization governs itself exactly when it carries an
    // assignment. `organizations_reach_excluded` is its `not mine` half, which
    // the tenant filter reads as `col not in (select x from
    // organizations_reach_excluded(rep, rollup) as x)`; `reachOf` reads the
    // split in one scan for both of its lists, so the list and the filter
    // cannot drift. Both are `language sql`, `stable`, no `SET`, not
    // `security definer`: the conditions for PostgreSQL to inline them (the
    // excluded set plans as a hashed anti join, the filter as a hashed
    // SubPlan) rather than run an opaque Function Scan.
    this.addSql(`
      create or replace function "organizations_reach_split"(p_admin_user_id uuid, p_rollup boolean)
      returns table ("organization_id" uuid, "mine" boolean) language sql stable parallel safe as $$
        select g."organization_id", m."organization_id" is not null
          from "organization_reach_governor" g
          left join (
            select distinct a."organization_id"
              from "organization_sales_rep_assignments" a
             where a."admin_user_id" = p_admin_user_id
          ) m on m."organization_id" = g."governor_id"
         where p_rollup or g."governor_id" = g."organization_id"
      $$;
    `);
    this.addSql(`
      create or replace function "organizations_reach_excluded"(p_admin_user_id uuid, p_rollup boolean)
      returns setof uuid language sql stable parallel safe as $$
        select s."organization_id" from "organizations_reach_split"(p_admin_user_id, p_rollup) s where not s."mine"
      $$;
    `);

    // The backfill: the same function, over everything.
    this.addSql(`select "organizations_reach_governor_rebuild"(null);`);
  }

  override async down(): Promise<void> {
    for (const [name, table] of [...STATEMENT_TRIGGERS, ...TRUNCATE_TRIGGERS]) {
      this.addSql(`drop trigger if exists "${name}" on "${table}";`);
    }
    this.addSql(`drop function if exists "organizations_reach_excluded"(uuid, boolean);`);
    this.addSql(`drop function if exists "organizations_reach_split"(uuid, boolean);`);
    this.addSql(`drop function if exists "organizations_reach_governor_on_truncate"();`);
    this.addSql(`drop function if exists "organizations_reach_governor_on_organizations"();`);
    this.addSql(`drop function if exists "organizations_reach_governor_on_assignments"();`);
    this.addSql(`drop function if exists "organizations_reach_governor_rebuild"(uuid[]);`);
    this.addSql(`drop index if exists "organizations_unreadable_path_idx";`);
    this.addSql(`drop function if exists "organizations_tree_path_readable"(text, uuid);`);
    this.addSql(`drop index if exists "organizations_path_segments_idx";`);
    this.addSql(`drop table if exists "organization_reach_governor";`);
  }
}

const STATEMENT_TRIGGERS = [
  ['organization_reach_governor_assignments_insert', 'organization_sales_rep_assignments', 'insert', 'new table as "reach_new"'],
  ['organization_reach_governor_assignments_update', 'organization_sales_rep_assignments', 'update', 'old table as "reach_old" new table as "reach_new"'],
  ['organization_reach_governor_assignments_delete', 'organization_sales_rep_assignments', 'delete', 'old table as "reach_old"'],
  ['organization_reach_governor_organizations_insert', 'organizations', 'insert', 'new table as "reach_new"'],
  ['organization_reach_governor_organizations_update', 'organizations', 'update', 'old table as "reach_old" new table as "reach_new"'],
  ['organization_reach_governor_organizations_delete', 'organizations', 'delete', 'old table as "reach_old"'],
] as const;

const TRUNCATE_TRIGGERS = [
  ['organization_reach_governor_assignments_truncate', 'organization_sales_rep_assignments'],
  ['organization_reach_governor_organizations_truncate', 'organizations'],
] as const;
