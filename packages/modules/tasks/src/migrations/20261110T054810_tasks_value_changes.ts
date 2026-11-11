import { Migration } from '@mikro-orm/migrations';

/**
 * A Task's own record of the values its writes changed (issue #470, D-288;
 * `specs/conventions/audit-state.md` §3).
 *
 * The platform audit log is not tenant-scoped, so from this release a
 * `tasks.*` audit entry names the fields a write changed and never their
 * values: the title (owner ruling O-1, 2026-11-10), the context note, the
 * custom-field values and an attachment's file name. The Task's history still
 * shows them, from here. One row per Command that changed one of them, written
 * in that Command's transaction; the audit entry points at it by
 * `valueChangeId`.
 *
 * `before` is `null` for something that only arrived and `after` for something
 * that went; each side holds only the keys that changed. The rows go with the
 * Task (`on delete cascade`). Audit entries written before this migration are
 * not touched (owner ruling O-4): they keep the values they were written with.
 */
export class Migration20261110T054810TasksValueChanges extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "task_value_changes" (
        "id" uuid not null default gen_random_uuid(),
        "task_id" uuid not null,
        "before" jsonb null,
        "after" jsonb null,
        "at" timestamptz not null default now(),
        constraint "task_value_changes_pkey" primary key ("id"),
        constraint "task_value_changes_task_fk" foreign key ("task_id")
          references "tasks" ("id") on delete cascade
      );
    `);
    this.addSql(`create index "task_value_changes_task_id_index" on "task_value_changes" ("task_id");`);
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "task_value_changes" cascade;');
  }
}
