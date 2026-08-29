import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 068 — nullable JSONB envelope for adapter-specific checkout data
 * (e.g. InPost locker `targetPoint`) on `orders.shipping_adapter_data`.
 */
export class Migration20260804T114814OrdersShippingAdapterData extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "orders"
        add column "shipping_adapter_data" jsonb null;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      alter table "orders"
        drop column "shipping_adapter_data";
    `);
  }
}
