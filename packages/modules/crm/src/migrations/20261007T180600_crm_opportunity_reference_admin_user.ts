import { Migration } from '@mikro-orm/migrations';

/**
 * User Story 18 of `specs/143-crm-sales-opportunities/` — a person may be
 * mentioned in a description, a note or a message. The index of who mentions
 * what gains its third target type, `admin_user`, beside `product` and
 * `order`; the constraint is replaced, the rows are untouched.
 *
 * `target_id` stays a value, as it is for the other two: no foreign key, so no
 * other module's table is referenced and a mention of somebody since removed
 * simply renders as unavailable.
 */
export class Migration20261007T180600CrmOpportunityReferenceAdminUser extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "crm_opportunity_references" drop constraint "crm_opportunity_references_target_type_check";`,
    );
    this.addSql(`
      alter table "crm_opportunity_references"
        add constraint "crm_opportunity_references_target_type_check"
        check ("target_type" in ('product', 'order', 'admin_user'));
    `);
  }

  override async down(): Promise<void> {
    // A mention has no place in the narrower constraint; the text it was
    // derived from keeps its token, so the row comes back with the next save.
    this.addSql(`delete from "crm_opportunity_references" where "target_type" = 'admin_user';`);
    this.addSql(
      `alter table "crm_opportunity_references" drop constraint "crm_opportunity_references_target_type_check";`,
    );
    this.addSql(`
      alter table "crm_opportunity_references"
        add constraint "crm_opportunity_references_target_type_check"
        check ("target_type" in ('product', 'order'));
    `);
  }
}
