import { Migration } from '@mikro-orm/migrations';

/**
 * A custom-field definition names the buyer input surfaces its value may be
 * supplied on, and how the admin panel offers it
 * (`specs/175-buyer-input-custom-fields/`, data-model §1):
 *
 * - `customer_input` — the surfaces (`organization.register` today) a buyer
 *   may supply the value on. A list rather than a flag, so the next surface is
 *   data, not a column.
 * - `admin_access` — `edit`, `read` or `hidden` in the admin custom-field
 *   panel. A panel convenience, not access control: no API endpoint reads it.
 *
 * Every existing definition reads `[]` / `edit` — open on no surface and
 * editable, which is how it behaved — and nothing is back-filled. Existing
 * required definitions are `edit`, so "required ⇒ edit" holds for every row.
 *
 * `custom_field_definitions` is a platform-global table (no tenant column) and
 * neither column references another module's table.
 */
export class Migration20261106T094044CustomFieldsDefinitionCustomerInputAdminAccess extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "custom_field_definitions" add column "customer_input" jsonb not null default '[]'::jsonb;`,
    );
    this.addSql(
      `alter table "custom_field_definitions" add column "admin_access" varchar(16) not null default 'edit';`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "custom_field_definitions" drop column "admin_access";`);
    this.addSql(`alter table "custom_field_definitions" drop column "customer_input";`);
  }
}
