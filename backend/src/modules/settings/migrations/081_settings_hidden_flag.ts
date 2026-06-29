import { Migration } from '@mikro-orm/migrations';

/**
 * Settings hidden flag (single-source-of-truth for module-owned settings).
 *
 * Adds a non-null `hidden` boolean column (default false) to `settings`. When
 * true the setting is excluded from the generic admin Settings screen and
 * managed only through its owning module's dedicated UI (e.g. the PWA settings
 * page), while remaining fully readable/writable by code. Purely additive —
 * existing rows default to visible, so no backfill is required.
 */
export class Migration081SettingsHiddenFlag extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "settings" add column "hidden" boolean not null default false;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "settings" drop column "hidden";`);
  }
}
