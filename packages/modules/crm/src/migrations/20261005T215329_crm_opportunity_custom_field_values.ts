import { Migration } from '@mikro-orm/migrations';

/**
 * User Story 15 of `specs/143-crm-sales-opportunities/` — operator-defined
 * fields on an Opportunity. Additive: the `custom_field_values` JSONB bag on
 * `crm_opportunities`, so the values persist on the host row, as they do for
 * Orders, Organizations, customers and Quote Requests.
 *
 * The column inherits the Opportunity's tenant classification (Constitution
 * XI) — it is a column on an organization-scoped row and gains no scoping
 * column of its own. It references no other module's table.
 */
export class Migration20261005T215329CrmOpportunityCustomFieldValues extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "crm_opportunities" add column "custom_field_values" jsonb not null default '{}';`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "crm_opportunities" drop column "custom_field_values";`);
  }
}
