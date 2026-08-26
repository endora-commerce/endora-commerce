import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 051 — Personal Organizations for B2C customers.
 *
 * Adds `organizations.is_personal` (a single-member org backing an individual)
 * and backfills a personal organization for every existing customer account with
 * no organization, linking the account to it. Idempotent — re-running skips
 * accounts that already have an organization.
 *
 * Backfill defaults for an individual (mirror `PersonalOrganizationService`):
 *   - is_personal = true, status = 'active'
 *   - name       = trimmed "first last", else the email local-part
 *   - tax_id     = the account UUID without dashes (tax_id is globally UNIQUE and
 *                  varchar(32); an individual has no company tax id, so a synthetic
 *                  32-hex unique value derived from the account id)
 *   - vat_status = 'vat_exempt'
 *   - registered_address = a minimal valid placeholder ({} JSON is not valid;
 *                  the column is a JSON object with street/city/postal/country)
 */
export class Migration20260717T151403OrganizationsPersonalOrganizations extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table "organizations" add column "is_personal" boolean not null default false;',
    );
    this.addSql('create index "organizations_is_personal_index" on "organizations" ("is_personal");');

    // Backfill: one personal org per no-org, non-deleted customer account.
    this.addSql(`
      with created as (
        insert into "organizations" (
          "id", "name", "tax_id", "status", "vat_status", "is_personal",
          "registered_address", "created_at", "updated_at"
        )
        select
          gen_random_uuid(),
          coalesce(nullif(trim(coalesce(ca."first_name", '') || ' ' || coalesce(ca."last_name", '')), ''), split_part(ca."email", '@', 1)),
          replace(ca."id"::text, '-', ''),
          'active',
          'vat_exempt',
          true,
          '{"street":"-","city":"-","postalCode":"-","country":"PL"}'::json,
          now(), now()
        from "customer_accounts" ca
        where ca."organization_id" is null and ca."deleted_at" is null
        returning "id", ("tax_id") as tax_id
      )
      update "customer_accounts" ca
      set "organization_id" = c."id"
      from created c
      where c."tax_id" = replace(ca."id"::text, '-', '');
    `);
  }

  override async down(): Promise<void> {
    // Unlink and remove the personal orgs created by this migration, then drop the column.
    this.addSql(`
      update "customer_accounts" ca
      set "organization_id" = null
      from "organizations" o
      where ca."organization_id" = o."id" and o."is_personal" = true;
    `);
    this.addSql('delete from "organizations" where "is_personal" = true;');
    this.addSql('drop index if exists "organizations_is_personal_index";');
    this.addSql('alter table "organizations" drop column "is_personal";');
  }
}
