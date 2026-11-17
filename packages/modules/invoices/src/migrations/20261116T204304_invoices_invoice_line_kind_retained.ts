import { Migration } from '@mikro-orm/migrations';

/**
 * Issue #854 — `invoice_lines.line_kind` admits `retained`: an amount withheld
 * on a return, invoiced as part of the goods' price at the VAT rate of the line
 * it was withheld from (owner ruling of 2026-11-07). The kind is stated, never
 * inferred: the line names no order item, so it must not read as a discount,
 * a charge or a price reduction.
 */
export class Migration20261116T204304InvoicesInvoiceLineKindRetained extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "invoice_lines" drop constraint if exists "invoice_lines_line_kind_check";');
    this.addSql(
      `alter table "invoice_lines" add constraint "invoice_lines_line_kind_check" check ("line_kind" is null or "line_kind" in ('goods', 'delivery', 'payment_surcharge', 'discount', 'price_reduction', 'retained'));`,
    );
  }

  override async down(): Promise<void> {
    this.addSql('alter table "invoice_lines" drop constraint if exists "invoice_lines_line_kind_check";');
    // The older constraint does not admit the kind; such a line reads as unnamed.
    this.addSql(`update "invoice_lines" set "line_kind" = null where "line_kind" = 'retained';`);
    this.addSql(
      `alter table "invoice_lines" add constraint "invoice_lines_line_kind_check" check ("line_kind" is null or "line_kind" in ('goods', 'delivery', 'payment_surcharge', 'discount', 'price_reduction'));`,
    );
  }
}
