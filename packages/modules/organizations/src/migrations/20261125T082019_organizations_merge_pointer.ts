import { Migration } from '@mikro-orm/migrations';

/**
 * The archived loser of an Organization merge (`specs/192-organization-merge/`
 * data-model §2.1, research R-7, R-14a).
 *
 * - `merged_into_organization_id`, `merged_at`, `merge_id`: set by
 *   `organization.merge.finalize` only. A merged row is always soft-deleted too
 *   (`organizations_merged_is_archived`), which is what keeps it out of every
 *   list, picker, count and tenant resolution with no new exclusion anywhere.
 * - The 177 rule "a company Organization stores a tax ID"
 *   (`organizations_tax_id_presence`, `is_personal = (tax_id is null)`) is
 *   relaxed for merged rows only: a merged loser may release its tax ID so the
 *   survivor can take it under the `global` scope, in one Command (R-14a). A
 *   personal row still never holds one.
 * - The index serves "merged from" on the survivor.
 *
 * The self-reference is this module's own table. Registration is a
 * regeneration: run `pnpm --filter backend run composer:generate` and commit
 * the result.
 */
export class Migration20261125T082019OrganizationsMergePointer extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "organizations"
      add column if not exists "merged_into_organization_id" uuid null,
      add column if not exists "merged_at" timestamptz null,
      add column if not exists "merge_id" uuid null;`);
    this.addSql(`do $$ begin
      if not exists (select 1 from pg_constraint where conname = 'organizations_merged_into_fk') then
        alter table "organizations" add constraint "organizations_merged_into_fk"
          foreign key ("merged_into_organization_id") references "organizations" ("id") on delete restrict;
      end if;
      if not exists (select 1 from pg_constraint where conname = 'organizations_merged_is_archived') then
        alter table "organizations" add constraint "organizations_merged_is_archived"
          check ("merged_into_organization_id" is null or "deleted_at" is not null);
      end if;
    end $$;`);
    this.addSql(`alter table "organizations" drop constraint if exists "organizations_tax_id_presence";`);
    this.addSql(`alter table "organizations" add constraint "organizations_tax_id_presence" check (
      ("is_personal" and "tax_id" is null)
      or (not "is_personal" and ("tax_id" is not null or "merged_into_organization_id" is not null))
    );`);
    this.addSql(
      `create index if not exists "organizations_merged_into_idx" on "organizations" ("merged_into_organization_id") ` +
        `where "merged_into_organization_id" is not null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "organizations_merged_into_idx";`);
    this.addSql(`alter table "organizations" drop constraint if exists "organizations_tax_id_presence";`);
    this.addSql(
      `alter table "organizations" add constraint "organizations_tax_id_presence" check ("is_personal" = ("tax_id" is null));`,
    );
    this.addSql(`alter table "organizations" drop constraint if exists "organizations_merged_is_archived";`);
    this.addSql(`alter table "organizations" drop constraint if exists "organizations_merged_into_fk";`);
    this.addSql(`alter table "organizations"
      drop column if exists "merge_id",
      drop column if exists "merged_at",
      drop column if exists "merged_into_organization_id";`);
  }
}
