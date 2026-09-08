import { Migration } from '@mikro-orm/migrations';

/**
 * Settings `credential_ref` value type (feature 058, US2).
 *
 * 1. Extends the `setting_value_type` Postgres enum with `'credential_ref'`.
 *    The enum is recreated (rename → create → re-point column → drop old)
 *    instead of `ALTER TYPE ... ADD VALUE` because the migrator runs with
 *    `allOrNothing: true` (one master transaction) and PostgreSQL forbids
 *    using an enum value added via ADD VALUE inside the same transaction.
 *    Mirrors `069_settings_secret_value_type.ts`.
 * 2. Adds the nullable `settings.configuration_type` column — the configuration
 *    type a `credential_ref` setting is constrained to (upserted by the
 *    reconciler from the manifest entry's `configurationType`).
 *
 * Filed under `core` since feature 072 T020. The kernel owns the tables this
 * migration writes to, and a hard uninstall reverts by registry `moduleId`, so
 * leaving it under `settings` made `modules:uninstall --hard settings` drop
 * kernel schema.
 */
export class Migration20260721T011510CoreSettingsCredentialRefValueType extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter type "setting_value_type" rename to "setting_value_type_old";`);
    this.addSql(`
      create type "setting_value_type" as enum
        ('string', 'number', 'boolean', 'json', 'string_list', 'secret', 'credential_ref');
    `);
    this.addSql(`
      alter table "settings"
        alter column "value_type" type "setting_value_type"
        using "value_type"::text::"setting_value_type";
    `);
    this.addSql(`drop type "setting_value_type_old";`);

    this.addSql(`alter table "settings" add column "configuration_type" varchar(64) null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "settings" drop column "configuration_type";`);

    // Every credential_ref row must leave the enum value before the narrowing
    // cast below.
    this.addSql(`
      update "settings"
        set "value_type" = 'string'
        where "value_type" = 'credential_ref';
    `);
    this.addSql(`alter type "setting_value_type" rename to "setting_value_type_old";`);
    this.addSql(`
      create type "setting_value_type" as enum
        ('string', 'number', 'boolean', 'json', 'string_list', 'secret');
    `);
    this.addSql(`
      alter table "settings"
        alter column "value_type" type "setting_value_type"
        using "value_type"::text::"setting_value_type";
    `);
    this.addSql(`drop type "setting_value_type_old";`);
  }
}
