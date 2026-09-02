import { Migration } from '@mikro-orm/migrations';

/**
 * Optional pickup-point snapshot selected at checkout.
 *
 * Stored on `orders` so shipment adapters can read the buyer's selected point
 * without re-resolving storefront payloads.
 */
export class Migration20260824T080000OrdersDeliveryPointSnapshot extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "orders" add column "delivery_point_snapshot" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "orders" drop column "delivery_point_snapshot";`);
  }
}
