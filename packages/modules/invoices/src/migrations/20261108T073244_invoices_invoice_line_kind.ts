import { Migration } from '@mikro-orm/migrations';

/**
 * Issue #904, Phase A — `invoice_lines.line_kind`: what a line is, one of
 * `goods`, `delivery`, `payment_surcharge`, `discount` or `price_reduction`.
 *
 * A charge line used to be told apart from the discount line by having no
 * `order_item_id` and by its sign. Once delivery and the payment surcharge
 * carry the goods' VAT, a charge line sits inside a goods rate's row, and the
 * per-rate maths of a correction has to tell it from a goods line at the same
 * rate: the kind has to be stated, not inferred.
 *
 * Written for every line of an invoice or a proforma issued from now on, the
 * 0 % charge lines included. Nullable, no backfill: `null` is a line issued
 * before (or a line no writer has named yet), read by the inference it always
 * was — an issued document is never rewritten.
 */
export class Migration20261108T073244InvoicesInvoiceLineKind extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "invoice_lines" add column if not exists "line_kind" varchar(24) null;');
    this.addSql('alter table "invoice_lines" drop constraint if exists "invoice_lines_line_kind_check";');
    this.addSql(
      `alter table "invoice_lines" add constraint "invoice_lines_line_kind_check" check ("line_kind" is null or "line_kind" in ('goods', 'delivery', 'payment_surcharge', 'discount', 'price_reduction'));`,
    );
  }

  override async down(): Promise<void> {
    this.addSql('alter table "invoice_lines" drop constraint if exists "invoice_lines_line_kind_check";');
    this.addSql('alter table "invoice_lines" drop column if exists "line_kind";');
  }
}
