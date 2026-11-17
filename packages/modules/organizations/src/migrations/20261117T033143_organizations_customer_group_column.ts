import { Migration } from '@mikro-orm/migrations';

/**
 * `organizations.customer_group_id` and its index — an Organization's customer
 * group, which the pricing evaluator's `customerGroup` criterion reads — created
 * by the module whose `Organization.customerGroupId` maps the column.
 *
 * Until issue #611 the only migration creating them was `price_lists`' frozen
 * `Migration20260426T075235PriceListsPricingInit`, so another module's
 * migration decided this module's schema — the write the migration
 * table-ownership rule (feature 097, R2) refuses, whether or not `price_lists`
 * declares this module, which it does. The frozen init keeps its class name and
 * lost only these statements and their inverses, the shape D-226 gave the
 * `cms_pages` index `assets_library`'s frozen init carried
 * (`Migration20260912T125709CmsPageBodyAssetRefIndex`).
 *
 * The column has no foreign key: `customer_groups` is `customer_accounts`'
 * table, and the frozen statement never referenced it, so nothing outside this
 * module's closure is named here.
 *
 * **`if not exists`**, because every database that ran the frozen init already
 * has both, and there this must be a no-op that keeps every value. The type,
 * nullability and index name are the frozen statements verbatim, so the two
 * paths reach one schema. `down()` drops both, as the frozen init's did: this
 * module creates `organizations` itself, so the table does not outlive it.
 */
export class Migration20261117T033143OrganizationsCustomerGroupColumn extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "organizations" add column if not exists "customer_group_id" uuid null;');
    this.addSql(
      'create index if not exists "organizations_customer_group_id_index" on "organizations" ("customer_group_id");',
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop index if exists "organizations_customer_group_id_index";');
    this.addSql('alter table "organizations" drop column if exists "customer_group_id";');
  }
}
