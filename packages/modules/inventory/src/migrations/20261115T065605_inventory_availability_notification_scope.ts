import { Migration } from '@mikro-orm/migrations';

/**
 * The scope a back-in-stock subscription was taken in — issue #696.
 *
 * `sales_channel_id` is the resolved request channel and `language_code` the scope language
 * resolved from the request's `Accept-Language` against that channel, both stamped by
 * `AvailabilityNotificationService.subscribe`. The buyer's back-in-stock e-mail reads the
 * product's effective name at that (channel, language) through catalog's `effectiveTexts`
 * (`specs/174-product-editor-scope-switcher/contracts/readers.md` §1).
 *
 * Both nullable, and nothing is backfilled: a row written before this migration has no known
 * scope, and its e-mail keeps the Global name it would have had anyway. The foreign key sets the
 * channel null when the channel is deleted, which reads the same way — Global — and leaves the
 * subscription itself alone. `sales_channels` is already in `inventory`'s manifest
 * `dependencies`, so the reference is ordered and declared (`module-migrations.md` item 4).
 */
export class Migration20261115T065605InventoryAvailabilityNotificationScope extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "availability_notifications"
        add column "sales_channel_id" uuid null,
        add column "language_code" varchar(16) null,
        add constraint "availability_notifications_sales_channel_fk"
          foreign key ("sales_channel_id") references "sales_channels" ("id") on delete set null;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      alter table "availability_notifications"
        drop constraint if exists "availability_notifications_sales_channel_fk",
        drop column if exists "language_code",
        drop column if exists "sales_channel_id";
    `);
  }
}
