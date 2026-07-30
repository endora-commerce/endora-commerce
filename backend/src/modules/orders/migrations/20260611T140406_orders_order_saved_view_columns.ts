import { Migration } from '@mikro-orm/migrations';

/**
 * Order-list saved-view column picker.
 *
 * Adds `order_list_saved_views.visible_columns` (nullable JSONB) so a saved view
 * can persist the operator's column-picker selection. NULL ⇒ the client falls
 * back to its default-visible set, keeping every pre-existing view valid.
 */
export class Migration20260611T140406OrdersOrderSavedViewColumns extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "order_list_saved_views" add column "visible_columns" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "order_list_saved_views" drop column "visible_columns";`);
  }
}
