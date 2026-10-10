import { Migration } from '@mikro-orm/migrations';

/**
 * A custom-field definition declares who its stored values are answered to:
 * `customer` (the buyer-facing and the external API replies carry them) or
 * `internal` (administrators only).
 *
 * Two statements, and their order is the point. The column is added with the
 * default `customer`, so every definition that already exists keeps answering
 * its values exactly as it did before the upgrade — nothing disappears from a
 * storefront or an integration silently. The default is then moved to
 * `internal`, so a row written from here on without an audience is one whose
 * values stay inside the admin API until somebody opens it.
 *
 * `custom_field_definitions` is a platform-global table (no tenant column) and
 * the column references no other module's table.
 */
export class Migration20261010T090000CustomFieldsDefinitionAudience extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "custom_field_definitions" add column "audience" varchar(16) not null default 'customer';`,
    );
    this.addSql(
      `alter table "custom_field_definitions" alter column "audience" set default 'internal';`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "custom_field_definitions" drop column "audience";`);
  }
}
