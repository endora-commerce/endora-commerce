import { Migration } from '@mikro-orm/migrations';

/**
 * D-187 — the attribution CHECK on `admin_impersonation_reasons`, which
 * `Migration20261115T190121AdminUsersImpersonationReasons` created without it.
 *
 * Every `@CustomerScoped` table that names a customer account and an
 * Organization carries `check ("customer_account_id" is null or
 * "organization_id" is not null)`, so the attribution holds even where a later
 * change relaxes a column's `not null`; the tenancy completeness test
 * (`backend/test/integration/tenancy/customer-scoped-organization-completeness.test.ts`)
 * refuses a table without it.
 *
 * Both columns are `not null` already, so no existing row can violate the
 * constraint. This is a new migration rather than an edit of the one that
 * created the table, because that one has already been applied on instances
 * running `master`.
 */
export class Migration20261116T131329AdminUsersImpersonationReasonAttribution extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "admin_impersonation_reasons"
        add constraint "admin_impersonation_reasons_organization_attribution_chk"
        check ("customer_account_id" is null or "organization_id" is not null);
    `);
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "admin_impersonation_reasons" drop constraint if exists "admin_impersonation_reasons_organization_attribution_chk";`,
    );
  }
}
