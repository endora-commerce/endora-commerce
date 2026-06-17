import { Migration } from '@mikro-orm/migrations';

/**
 * Backfill the awaiting-acceptance flag for legacy admin-created quotes.
 *
 * Quote Requests created on the customer's behalf (status `Created from admin`)
 * must surface the Accept/Reject controls on the storefront, which gate on
 * `awaiting_customer_revision_acceptance`. The service now sets that flag at
 * creation time (see RfqAdminService.createOnBehalf), but rows created before
 * that fix landed still have the flag at its `false` default, so the customer
 * has no way to act on them.
 *
 * Any RFQ still in `Created from admin` status is genuinely awaiting the
 * customer's decision (acceptance moves it to `Approved`, rejection to
 * `Canceled`), so flipping the flag for exactly those rows is safe and
 * idempotent.
 */
export class Migration076BackfillAdminCreatedAwaiting extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `update "quote_requests"
         set "awaiting_customer_revision_acceptance" = true
       where "status" = 'Created from admin'
         and "awaiting_customer_revision_acceptance" = false;`,
    );
  }

  override async down(): Promise<void> {
    // Non-reversible data backfill: the original per-row flag value is not
    // recoverable. Leaving the rows as-is on rollback is the safe choice.
  }
}
