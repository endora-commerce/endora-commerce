import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 055 — Custom Fields Layer. Additive: adds the `custom_field_values`
 * JSONB bag to `quote_requests` so operator-defined fields persist on the host row.
 * The column inherits the host entity's tenant classification (Principle XI);
 * no scoping column is added.
 */
export class Migration095QuoteRequestCustomFieldValues extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "quote_requests" add column "custom_field_values" jsonb not null default '{}';`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "quote_requests" drop column "custom_field_values";`);
  }
}
