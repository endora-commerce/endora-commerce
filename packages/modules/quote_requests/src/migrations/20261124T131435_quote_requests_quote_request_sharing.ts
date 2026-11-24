import { Migration } from '@mikro-orm/migrations';

/**
 * An operator's quote request stays unshared until an operator shares it with
 * the customer (`specs/192-quote-request-draft-share/`, data-model §1–§2,
 * research R-17).
 *
 * - `shared_with_customer` — `not null default true`, so every existing row,
 *   and every creation path that does not name it, stays visible to its
 *   customer in the same statement (FR-002): no backfill.
 * - `shared_at`, `shared_by_admin_user_id` — when and by whom an unshared quote
 *   was shared. A plain uuid with no foreign key, as `created_by_admin_user_id`:
 *   `admin_users` is another module's table.
 * - `share_validity_days` — the validity days applied at the share; `null` = no
 *   deadline.
 * - `qre_event_type_check` gains `shared`, the history entry of the share.
 *
 * No index: the customer list already filters on the indexed
 * `customer_account_id`, and the expiry sweep's predicate gains a boolean on
 * rows it already scans.
 *
 * `down()` drops the four columns and restores the thirteen event types of the
 * `custom-field-carry-skipped` migration; it fails while a `shared` event row
 * exists — as narrowing any check must.
 */
const BEFORE = `'created','submitted','modified','approved','canceled','expired',
  'completed','customer-accepted-revision','customer-rejected-revision',
  're-submitted','note-added','pdf-sent','custom-field-carry-skipped'`;

export class Migration20261124T131435QuoteRequestsQuoteRequestSharing extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "quote_requests"
         add column "shared_with_customer" boolean not null default true,
         add column "shared_at" timestamptz null,
         add column "shared_by_admin_user_id" uuid null,
         add column "share_validity_days" integer null;`,
    );
    this.addSql(
      `alter table "quote_requests" add constraint "quote_requests_share_validity_days_check"
         check ("share_validity_days" is null or "share_validity_days" >= 0);`,
    );
    this.addSql(`alter table "quote_request_events" drop constraint "qre_event_type_check";`);
    this.addSql(
      `alter table "quote_request_events" add constraint "qre_event_type_check" check ("event_type" in (${BEFORE}, 'shared'));`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "quote_request_events" drop constraint "qre_event_type_check";`);
    this.addSql(
      `alter table "quote_request_events" add constraint "qre_event_type_check" check ("event_type" in (${BEFORE}));`,
    );
    this.addSql(`alter table "quote_requests" drop constraint "quote_requests_share_validity_days_check";`);
    this.addSql(
      `alter table "quote_requests"
         drop column "shared_with_customer",
         drop column "shared_at",
         drop column "shared_by_admin_user_id",
         drop column "share_validity_days";`,
    );
  }
}
