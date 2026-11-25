import { Migration } from '@mikro-orm/migrations';

/**
 * The archived loser of a Project merge (`specs/192-organization-merge/` US6,
 * data-model §3, FR-051).
 *
 * - `merged_into_project_id`, `merged_at`, `merge_id`: set by
 *   `projects.project.merge.finalize` only. A Project has no soft delete and
 *   its delete cascades, so the loser is **kept** with this pointer: every
 *   list, count, search, picker and read-port query of the module leaves out a
 *   row that carries one, and a read by id answers it with its survivor.
 * - The pointer cascades: deleting the survivor deletes its archived
 *   duplicates with it, whose records it had already absorbed — a pointer
 *   never dangles, and a deleted survivor leaves no archived Project behind
 *   that would lead nowhere.
 * - The index serves "merged from" on the survivor.
 *
 * The self-reference is this module's own table. Registration is a
 * regeneration: run `pnpm --filter backend run composer:generate` and commit
 * the result.
 */
export class Migration20261125T124200ProjectsMergePointer extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "projects"
      add column if not exists "merged_into_project_id" uuid null,
      add column if not exists "merged_at" timestamptz null,
      add column if not exists "merge_id" uuid null;`);
    this.addSql(`do $$ begin
      if not exists (select 1 from pg_constraint where conname = 'projects_merged_into_fk') then
        alter table "projects" add constraint "projects_merged_into_fk"
          foreign key ("merged_into_project_id") references "projects" ("id") on delete cascade;
      end if;
      if not exists (select 1 from pg_constraint where conname = 'projects_merged_not_self') then
        alter table "projects" add constraint "projects_merged_not_self"
          check ("merged_into_project_id" is null or "merged_into_project_id" <> "id");
      end if;
    end $$;`);
    this.addSql(
      `create index if not exists "projects_merged_into_idx" on "projects" ("merged_into_project_id") ` +
        `where "merged_into_project_id" is not null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "projects_merged_into_idx";`);
    this.addSql(`alter table "projects" drop constraint if exists "projects_merged_not_self";`);
    this.addSql(`alter table "projects" drop constraint if exists "projects_merged_into_fk";`);
    this.addSql(`alter table "projects"
      drop column if exists "merge_id",
      drop column if exists "merged_at",
      drop column if exists "merged_into_project_id";`);
  }
}
