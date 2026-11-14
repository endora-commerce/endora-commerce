import { Migration } from '@mikro-orm/migrations';

/**
 * Optimistic concurrency for a Project's configuration (issue #449). Two
 * tokens, each moved by the writes it guards, and neither of them the
 * Project's `version`, which moves, closes, reopens and edits keep naming:
 *
 * - `project_stages.version` — a Stage's own edits (its attributes, its Stage
 *   Task definitions);
 * - `projects.configuration_version` — the Project's sets: adding, deleting
 *   and reordering Stages, the workflow, the Organizations and the Members.
 *
 * Every existing row starts at 1, as a new one does.
 */
export class Migration20261114T153132ProjectsConfigurationVersions extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "project_stages" add column "version" int not null default 1;`);
    this.addSql(`alter table "projects" add column "configuration_version" int not null default 1;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "projects" drop column if exists "configuration_version";`);
    this.addSql(`alter table "project_stages" drop column if exists "version";`);
  }
}
