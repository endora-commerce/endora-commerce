import { Migration } from '@mikro-orm/migrations';

/**
 * Catalog feature 022 / T028 — Add the `mass_editable` flag to
 * `product_attributes`.
 *
 * The flag gates whether an attribute appears in the Products Bulk Edit
 * dialog (admin UI). Default `false` so no attribute becomes bulk-editable
 * on rollout until an operator opts it in explicitly.
 *
 * See specs/022-products-bulk-edit/data-model.md §1 and research.md R-2.
 */
export class Migration043AttributeMassEditable extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "product_attributes"
        add column "mass_editable" boolean not null default false;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "product_attributes" drop column "mass_editable";`);
  }
}
