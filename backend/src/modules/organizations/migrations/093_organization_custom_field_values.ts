import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 055 — Custom Fields Layer. Additive: adds the `custom_field_values`
 * JSONB bag to `organizations` so operator-defined fields persist on the host row.
 * The column inherits the host entity's tenant classification (Principle XI);
 * no scoping column is added.
 */
export class Migration093OrganizationCustomFieldValues extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "organizations" add column "custom_field_values" jsonb not null default '{}';`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "organizations" drop column "custom_field_values";`);
  }
}
