import { Migration } from '@mikro-orm/migrations';

/**
 * `refunds.corrective_invoice_outcome` — the three-way answer, persisted
 * (D-92, issue #156).
 *
 * The row held `corrective_invoice_id` alone, so `null` stood for "no
 * correction was due", "none was asked for" and "one was asked for and we do
 * not know" at once. The distinction lived in the settlement response and the
 * audit entry, neither of which survives a page reload — which is exactly the
 * confusion the explicit `reason` field was added to prevent (#135).
 *
 * `not_requested` is the default because it is what a row with no correction
 * asked for means, and the backfill promotes the rows that carry a document.
 * `corrective_invoice_id` stays, and stays non-null exactly when the outcome is
 * `issued`.
 *
 * The pre-D-92 rows with no document are backfilled to `not_requested` rather
 * than `not_due`: which of the two they were is not recoverable from the row,
 * and claiming the more specific answer would invent it.
 */
export class Migration20260817T203206ReturnsRefundCorrectiveInvoiceOutcome extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "refunds"
        add column "corrective_invoice_outcome" varchar(16) not null default 'not_requested';
    `);
    this.addSql(`
      alter table "refunds"
        add constraint "refunds_corrective_invoice_outcome_check"
        check ("corrective_invoice_outcome" in ('issued', 'not_due', 'not_requested'));
    `);
    this.addSql(`
      update "refunds"
         set "corrective_invoice_outcome" = 'issued'
       where "corrective_invoice_id" is not null;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      alter table "refunds"
        drop constraint if exists "refunds_corrective_invoice_outcome_check";
    `);
    this.addSql(`alter table "refunds" drop column if exists "corrective_invoice_outcome";`);
  }
}
