import { Migration } from '@mikro-orm/migrations';

/**
 * Back-in-stock subscriptions the stock worker consumed read as `notified` — issue #1291.
 *
 * `AvailabilityWorker.dispatchForStockIncrease`, the sender `inventory.adjusted.v1` triggers,
 * stamped only `notified_at` on a subscription it had consumed, so the row kept
 * `status = 'queued'` and showed as waiting in the admin back-in-stock list and its status
 * filter. The worker now writes `status = 'notified'` beside `notified_at`, as
 * `processRestockedFanOut` always did; this corrects the rows it left behind.
 *
 * `notified_at is not null and status = 'queued'` is a state no sender writes any more: every
 * consumer of a row stamps `notified_at` together with a final status, and `subscribe` writes a
 * new row with `notified_at` null. Such a row was mailed, or consumed with its e-mail switched
 * off, or had lost its address — the last of which the worker now closes as `cancelled`. The
 * three cannot be told apart from the row, so all of them become `notified`, which is what the
 * customer-facing outcome was: nothing more will be sent for that subscription.
 *
 * `down()` changes nothing: a corrected row is indistinguishable from one a sender notified, so
 * reverting would also re-queue rows that were always right.
 */
export class Migration20261115T182156InventoryAvailabilityNotificationNotifiedStatus extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      update "availability_notifications"
        set "status" = 'notified'
        where "notified_at" is not null and "status" = 'queued';
    `);
  }

  override async down(): Promise<void> {
    // Intentionally empty — see the class comment.
  }
}
