import { Migration } from '@mikro-orm/migrations';

/**
 * Issue #417 (owner rulings of 2026-10-24, review of PR #423) —
 * `invoices.vat_summary`: the per-rate VAT summary a document was issued with,
 * as two-place decimal strings (`[{ taxRate, netTotal, vatAmount, grossTotal }]`).
 *
 * Written by issuance and by a correction from 0.108.0. A document's line
 * grosses are each line's own rounding and need not add up to its total, so its
 * summary cannot be derived back from its lines; it is stored instead. Nullable,
 * no backfill: `null` is a document issued before (or imported from an ERP),
 * whose summary is derived from its stored lines exactly as it was then — so
 * the presence of the column's value is what decides, never a guess.
 */
export class Migration20261024T145631InvoicesVatSummary extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "invoices" add column if not exists "vat_summary" jsonb null;');
  }

  override async down(): Promise<void> {
    this.addSql('alter table "invoices" drop column if exists "vat_summary";');
  }
}
