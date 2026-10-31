import { Migration } from '@mikro-orm/migrations';

/**
 * Issue #560 — `module_actions.keywords_key`.
 *
 * The bundle key a manifest action names for its per-language search words
 * (`ModuleActionSchema.keywordsKey`). Nullable: an action declaring none keeps
 * only its manifest `keywords`, which is every row this migration finds. The
 * reconciler fills the column on the next install or boot reconcile.
 */
export class Migration20261030T145645AdminActionsKeywordsKey extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "module_actions" add column if not exists "keywords_key" varchar(255) null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "module_actions" drop column if exists "keywords_key";`);
  }
}
