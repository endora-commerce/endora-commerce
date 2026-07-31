import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 043 — packaging-unit snapshot on quote-request lines. The unit name
 * is also appended to `product_name`. Nullable — plain lines have none.
 */
export class Migration20260611T140415QuoteRequestsQrItemPackaging extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "quote_request_items" add column "packaging_unit_name" varchar(160) null;');
    this.addSql('alter table "quote_request_items" add column "packaging_unit_base_quantity" integer null;');
  }

  override async down(): Promise<void> {
    this.addSql('alter table "quote_request_items" drop column "packaging_unit_base_quantity";');
    this.addSql('alter table "quote_request_items" drop column "packaging_unit_name";');
  }
}
