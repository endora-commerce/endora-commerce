import { Migration } from '@mikro-orm/migrations';

/**
 * `shipments.status` gains `pending_manual` (issue #250).
 *
 * A shipment opened while the module contributing its carrier adapter is not
 * present was written as `pending` and was then indistinguishable from a
 * shipment the carrier had actually been asked for. The fourth value is what
 * makes that row say so; the check constraint is what keeps the set of values
 * a single decision instead of a convention.
 *
 * The constraint was created by `delivery_methods` when this table was still
 * part of that module's schema; the table has been `shipments`' own since the
 * `shipments_order_fk` migration, so the widening belongs here.
 */
export class Migration20260819T171006ShipmentsStatusPendingManual extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "shipments" drop constraint if exists "shipments_status_check";`);
    this.addSql(
      `alter table "shipments" add constraint "shipments_status_check" ` +
        `check ("status" in ('pending', 'pending_manual', 'success', 'failure'));`,
    );
  }

  override async down(): Promise<void> {
    // A rollback removes the vocabulary, not the rows. `pending_manual` folds
    // back to `pending`, which is where those shipments sat before this
    // migration and is the only pre-existing value that still describes them:
    // they are open, and nothing was rejected.
    this.addSql(`update "shipments" set "status" = 'pending' where "status" = 'pending_manual';`);
    this.addSql(`alter table "shipments" drop constraint if exists "shipments_status_check";`);
    this.addSql(
      `alter table "shipments" add constraint "shipments_status_check" ` +
        `check ("status" in ('pending', 'success', 'failure'));`,
    );
  }
}
