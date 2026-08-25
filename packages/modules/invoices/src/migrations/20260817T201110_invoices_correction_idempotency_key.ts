import { Migration } from '@mikro-orm/migrations';

/**
 * `invoices.correction_idempotency_key` — one correction per return case (D-91).
 *
 * The settlement ordering law attempts every external effect before it writes
 * any state, so a refusal from a later step leaves a retryable case and the
 * retry asks `invoices` for the same correction again. The key is the return
 * case id: a second partial return against the same order is a different case
 * and still gets its own document.
 *
 * Nullable, because every correction issued before this migration has no key
 * and manual corrections have none either. The unique index is therefore
 * partial — `where "correction_idempotency_key" is not null` — so the absence
 * is not a value two rows can collide on.
 */
export class Migration20260817T201110InvoicesCorrectionIdempotencyKey extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "invoices"
        add column "correction_idempotency_key" varchar(64) null;
    `);
    this.addSql(`
      create unique index "invoices_correction_idempotency_key_unique"
        on "invoices" ("correction_idempotency_key")
        where "correction_idempotency_key" is not null;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "invoices_correction_idempotency_key_unique";`);
    this.addSql(`alter table "invoices" drop column if exists "correction_idempotency_key";`);
  }
}
