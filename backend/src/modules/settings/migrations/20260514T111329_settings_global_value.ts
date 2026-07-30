import { Migration } from '@mikro-orm/migrations';

/**
 * Add a platform-wide "global override" tier to settings.
 *
 * Before: resolver chain was per-channel `setting_values` row → manifest
 * `settings.default_value`. "All channels" admin writes broadcast a row
 * to every channel.
 *
 * After: chain is per-channel `setting_values` row → `settings.global_value`
 * (when non-NULL) → manifest `settings.default_value`. "All channels" admin
 * writes update `global_value` only; per-channel rows are untouched. Channels
 * without an explicit override inherit `global_value` when present, otherwise
 * fall back to the manifest default.
 *
 * A NULL `global_value` means "no global override set" — the admin has not
 * customised the platform-wide value, so the manifest default applies. An
 * admin who legitimately wants a literal JSON null at the global tier still
 * needs the per-channel route; this is an accepted edge case (see
 * specs/004-settings-module/data-model.md once it's updated).
 */
export class Migration20260514T111329SettingsGlobalValue extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table "settings" add column "global_value" jsonb null;',
    );
  }

  override async down(): Promise<void> {
    this.addSql('alter table "settings" drop column "global_value";');
  }
}
