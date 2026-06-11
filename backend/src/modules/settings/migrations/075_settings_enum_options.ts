import { Migration } from '@mikro-orm/migrations';

/**
 * Settings enum options (task: Speculation Rules eagerness dropdown).
 *
 * Adds a nullable `enum_options` JSONB column to `settings`. When non-null the
 * setting is an enum-style `string` setting: the admin renders a dropdown and
 * the backend constrains writes to the listed values. NULL keeps the legacy
 * free-text behaviour, so the column is purely additive and needs no backfill.
 */
export class Migration075SettingsEnumOptions extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "settings" add column "enum_options" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "settings" drop column "enum_options";`);
  }
}
