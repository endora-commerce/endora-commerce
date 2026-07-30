import { Migration } from '@mikro-orm/migrations';

/**
 * Settings `secret` value type (feature 043, FR-021 / research §R10).
 *
 * 1. Extends the `setting_value_type` Postgres enum with `'secret'`. The enum
 *    is recreated (rename → create → re-point column → drop old) instead of
 *    `ALTER TYPE ... ADD VALUE` because the migrator runs with
 *    `allOrNothing: true` (one master transaction) and PostgreSQL forbids
 *    using an enum value added via ADD VALUE inside the same transaction.
 *    Values present in a CREATE TYPE carry no such restriction.
 * 2. Retrofits `search.llm.embedder_api_key` (feature 006) to the new type so
 *    the boot reconciler sees no `valueType` diff against the updated search
 *    manifest. The stored value itself needs no rewrite: a legacy plaintext
 *    string keeps resolving via the codec's passthrough and is re-encrypted
 *    on the next admin write.
 */
export class Migration20260611T140411SettingsSecretValueType extends Migration {
  override async up(): Promise<void> {
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

    this.addSql(`
      update "settings"
        set "value_type" = 'secret'
        where "code" = 'search.llm.embedder_api_key';
    `);
  }

  override async down(): Promise<void> {
    // Every secret row (the retrofitted search key plus any reconciler-created
    // secrets, e.g. prompt_actions.api_key) must leave the enum value before
    // the narrowing cast below.
    this.addSql(`
      update "settings"
        set "value_type" = 'string'
        where "value_type" = 'secret';
    `);
    this.addSql(`alter type "setting_value_type" rename to "setting_value_type_old";`);
    this.addSql(`
      create type "setting_value_type" as enum
        ('string', 'number', 'boolean', 'json', 'string_list');
    `);
    this.addSql(`
      alter table "settings"
        alter column "value_type" type "setting_value_type"
        using "value_type"::text::"setting_value_type";
    `);
    this.addSql(`drop type "setting_value_type_old";`);
  }
}
