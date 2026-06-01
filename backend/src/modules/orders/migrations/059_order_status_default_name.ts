import { Migration } from '@mikro-orm/migrations';

/**
 * Order-status default name (feature 039 follow-up).
 *
 * Adds `order_statuses.default_name` — a language-independent fallback used
 * when the viewer's active language has no entry in the `name` map
 * (resolution: name[lang] → default_name → code). Backfills existing rows
 * from the English label, falling back to the code.
 */
export class Migration059OrderStatusDefaultName extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "order_statuses" add column "default_name" varchar(120) not null default '';`,
    );
    this.addSql(
      `update "order_statuses" set "default_name" = coalesce(nullif("name"->>'en', ''), "code") where "default_name" = '';`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "order_statuses" drop column "default_name";`);
  }
}
