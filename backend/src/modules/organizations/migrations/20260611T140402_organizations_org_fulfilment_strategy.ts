import { Migration } from '@mikro-orm/migrations';

/**
 * Organization-level warehouse-picking (fulfilment) strategy override.
 *
 * Adds the two nullable columns that mirror the per-product columns on
 * `products`. They participate in the order-placement precedence chain
 * Product → Organization → Sales Channel setting → platform default.
 * `null` ⇒ the organization inherits the channel/default strategy.
 */
export class Migration20260611T140402OrganizationsOrgFulfilmentStrategy extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "organizations" add column "fulfilment_strategy" varchar(32) null;`,
    );
    this.addSql(
      `alter table "organizations" add column "fulfilment_strategy_warehouse_order" jsonb null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "organizations" drop column "fulfilment_strategy_warehouse_order";`);
    this.addSql(`alter table "organizations" drop column "fulfilment_strategy";`);
  }
}
