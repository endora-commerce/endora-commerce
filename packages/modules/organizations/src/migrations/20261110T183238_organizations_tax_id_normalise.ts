import { Migration } from '@mikro-orm/migrations';

/** The canonical form, in SQL: whitespace and dashes removed, upper-cased (`normalizeTaxId`). */
const NORMALISED = `upper(regexp_replace("tax_id", '[[:space:]-]', '', 'g'))`;

/**
 * The tax IDs that normalise to one value where the active scope forbids
 * sharing it: anywhere in `global`, across trees in `per-tree-root`.
 */
const COLLISIONS = `
  select t."n", array_agg(t."id"::text order by t."id") as "ids"
    from (select "id", "root_id", ${NORMALISED} as "n" from "organizations" where "tax_id" is not null) t
   group by t."n"
  having (v_scope = 'global' and count(*) > 1)
      or (v_scope <> 'global' and count(distinct t."root_id") > 1)`;

/**
 * `specs/177-tax-id-scope/` D-290 / OD-11 — tax IDs are stored normalised.
 *
 * The scope's constraints compare stored text, so `526-025-09-95` and
 * `5260250995` in two trees satisfied both while being one tax ID. Every writer
 * now stores the canonical form (`normalizeTaxId`: whitespace and dashes
 * removed, upper-cased); this migration rewrites the rows written before, and
 * adds `organizations_tax_id_normalised`, which refuses anything else from any
 * writer to come.
 *
 * **It refuses, and changes nothing, when normalising would make two rows one
 * tax ID where the scope (read from `organization_tax_id_policy`) forbids
 * sharing it** — anywhere in `global`, across trees in `per-tree-root` — and
 * lists up to 50 such groups with their organization ids. It merges, renames
 * and picks nothing: which organization keeps the tax ID is the operator's
 * call. The upgrade note gives the query to find them before upgrading.
 *
 * Every table touched is this module's own. Repeatable: the update touches only
 * rows that differ, and the check is added only when absent.
 *
 * `down()` drops the check; the original spellings are not kept.
 *
 * Registration is a regeneration: `pnpm --filter backend run composer:generate`.
 */
export class Migration20261110T183238OrganizationsTaxIdNormalise extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      do $$
      declare
        v_scope text;
        v_count integer;
        v_list text;
      begin
        select coalesce((select "scope" from "organization_tax_id_policy" where "id"), 'global') into v_scope;
        select count(*) into v_count from (${COLLISIONS}) c;
        if v_count > 0 then
          select string_agg(c."n" || ': ' || array_to_string(c."ids", ', '), '; ' order by c."n") into v_list
            from (${COLLISIONS} order by t."n" limit 50) c;
          raise exception using
            message = 'organizations: ' || v_count || ' tax ID(s) would be held by more than one organization once '
              || 'normalised (scope ' || v_scope || '). Give each organization its own tax ID, then run the '
              || 'migration again. ' || v_list;
        end if;
      end
      $$;
    `);
    this.addSql(`
      update "organizations" set "tax_id" = ${NORMALISED}
       where "tax_id" is not null and "tax_id" <> ${NORMALISED};
    `);
    this.addSql(`
      do $$
      begin
        if not exists (
          select 1 from pg_constraint
           where conrelid = 'organizations'::regclass and conname = 'organizations_tax_id_normalised'
        ) then
          alter table "organizations"
            add constraint "organizations_tax_id_normalised"
            check ("tax_id" is null or "tax_id" = ${NORMALISED});
        end if;
      end
      $$;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "organizations" drop constraint if exists "organizations_tax_id_normalised";`);
  }
}
