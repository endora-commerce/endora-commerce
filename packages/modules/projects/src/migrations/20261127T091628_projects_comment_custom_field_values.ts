import { Migration } from '@mikro-orm/migrations';

/**
 * Issue #2005 — a note on a Project is a custom-field host (`project_note`).
 * Additive: the `custom_field_values` JSONB bag on `project_comments`, so a
 * note's values persist on its own row, as a Project's do on `projects`. A
 * message keeps `{}`.
 *
 * The column inherits the comment's tenant classification (Constitution XI) —
 * a comment is `@RuleScoped`, read under its Project's rule, and gains no
 * scoping column of its own. It references no other module's table.
 */
export class Migration20261127T091628ProjectsCommentCustomFieldValues extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "project_comments" add column "custom_field_values" jsonb not null default '{}';`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "project_comments" drop column "custom_field_values";`);
  }
}
