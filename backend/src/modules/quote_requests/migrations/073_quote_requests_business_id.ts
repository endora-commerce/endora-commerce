import { Migration } from '@mikro-orm/migrations';

/**
 * Customer-facing business Quote Request ID.
 *
 * Adds `quote_requests.business_id`: a human, business-facing identifier shown
 * to the Customer instead of the internal UUID `id`, mirroring
 * `orders.business_id` (feature 036). Its numeric core comes from a dedicated
 * monotonic sequence (`quote_requests_business_id_seq`); the optional
 * prefix/suffix are admin-configurable via the `quote_requests.business_id.*`
 * settings and applied at creation time by RfqService / RfqAdminService — not
 * here.
 *
 * Strategy:
 *   1. create the sequence,
 *   2. add a nullable `business_id` column,
 *   3. backfill every existing RFQ with the bare sequence value (empty
 *      default prefix/suffix),
 *   4. tighten to NOT NULL + UNIQUE.
 */
export class Migration073QuoteRequestsBusinessId extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create sequence if not exists "quote_requests_business_id_seq";`);
    this.addSql(`alter table "quote_requests" add column "business_id" varchar(128) null;`);
    this.addSql(
      `update "quote_requests" set "business_id" = nextval('quote_requests_business_id_seq')::text where "business_id" is null;`,
    );
    this.addSql(`alter table "quote_requests" alter column "business_id" set not null;`);
    this.addSql(
      `alter table "quote_requests" add constraint "quote_requests_business_id_unique" unique ("business_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "quote_requests" drop constraint "quote_requests_business_id_unique";`,
    );
    this.addSql(`alter table "quote_requests" drop column "business_id";`);
    this.addSql(`drop sequence if exists "quote_requests_business_id_seq";`);
  }
}
