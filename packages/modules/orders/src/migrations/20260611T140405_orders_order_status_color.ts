import { Migration } from '@mikro-orm/migrations';

/**
 * Order-status colour (configurable status badge colour).
 *
 * Adds `order_statuses.color` — a `#rrggbb` hex colour driving the admin status
 * badge. Defaults to a neutral slate (the legacy uncoloured look) and backfills
 * the seeded system / default statuses with sensible colours.
 */
export class Migration20260611T140405OrdersOrderStatusColor extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "order_statuses" add column "color" varchar(16) not null default '#64748b';`,
    );
    // Backfill the default/seeded statuses with curated colours. `new` stays
    // neutral slate (the column default), so it is intentionally omitted here.
    this.addSql(`update "order_statuses" set "color" = '#f59e0b' where "code" in ('pending', 'on_hold');`);
    this.addSql(`update "order_statuses" set "color" = '#3b82f6' where "code" in ('paid', 'processing');`);
    this.addSql(
      `update "order_statuses" set "color" = '#8b5cf6' where "code" in ('shipment_ready', 'shipment_sent');`,
    );
    this.addSql(`update "order_statuses" set "color" = '#10b981' where "code" = 'completed';`);
    this.addSql(`update "order_statuses" set "color" = '#ef4444' where "code" = 'cancelled';`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "order_statuses" drop column "color";`);
  }
}
