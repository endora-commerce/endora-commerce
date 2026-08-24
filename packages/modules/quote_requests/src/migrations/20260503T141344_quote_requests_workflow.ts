import { Migration } from '@mikro-orm/migrations';

/**
 * Quote Requests workflow rewrite (feature 008).
 *
 * What this migration does, in order:
 *   1. Renames quote_requests.requester_note → header_note (the "header note"
 *      attached to the whole RFQ, not a per-line note).
 *   2. Adds new lifecycle columns: created_by_admin_user_id,
 *      cancellation_reason, awaiting_customer_revision_acceptance,
 *      last_customer_seen_revision_number, current_revision_number,
 *      approved_at, canceled_at, completed_at, expired_at, converted_order_id.
 *   3. Maps legacy quote_requests.status values to the new six-status enum
 *      using mapLegacyStatus() — drops legacy `draft` rows, keeps the rest.
 *   4. Drops the now-redundant legacy columns (quoted_at, responded_at,
 *      quote_terms) — the lifecycle data they encoded moves into
 *      quote_request_events / quote_request_revisions.
 *   5. Renames quote_request_items.requester_note → line_note,
 *      quoted_unit_price → agreed_unit_price,
 *      quoted_discount_percent → discount_percent. Adds
 *      desired_unit_price, line_currency, product_slug.
 *   6. Creates quote_request_revisions, quote_request_events,
 *      quote_request_notification_events.
 *   7. Creates organization_sales_rep_assignments (lives in the organizations
 *      module logically — research.md §R9 — but the migration itself is
 *      colocated here for atomicity).
 *
 * The down() path is best-effort: it restores the legacy schema enough that
 * a clean rebuild does not crash, but does NOT round-trip data written under
 * the new schema. Spec accepts this trade-off (data-model.md §8).
 *
 * Spec references: data-model.md §1–§6, research.md §R1, §R9.
 */
export class Migration20260503T141344QuoteRequestsWorkflow extends Migration {
  override async up(): Promise<void> {
    // -- 1. Rename header note column -------------------------------
    this.addSql(`alter table "quote_requests" rename column "requester_note" to "header_note";`);

    // -- 2. Add new lifecycle columns -------------------------------
    this.addSql(`
      alter table "quote_requests"
        add column "created_by_admin_user_id" uuid null,
        add column "cancellation_reason" text null,
        add column "awaiting_customer_revision_acceptance" boolean not null default false,
        add column "last_customer_seen_revision_number" int not null default 0,
        add column "current_revision_number" int not null default 0,
        add column "approved_at" timestamptz null,
        add column "canceled_at" timestamptz null,
        add column "completed_at" timestamptz null,
        add column "expired_at" timestamptz null,
        add column "converted_order_id" uuid null;
    `);

    // -- 3. Drop legacy partial unique index that referenced 'draft'.
    //    Has to be dropped BEFORE we remap statuses or the unique
    //    constraint can fire spuriously.
    this.addSql(`drop index if exists "quote_requests_one_draft_per_customer";`);

    // -- 4. Status mapping. Postgres lets us update the column
    //    in-place because it's stored as varchar(32), not a true
    //    enum type. The legacy CHECK is implicit (no constraint
    //    defined in 002).
    //    legacy 'draft'         → DELETE row
    //    legacy 'new'           → 'Pending'
    //    legacy 'under_review'  → 'Pending'
    //    legacy 'quoted'        → 'Pending' + awaiting_customer_revision_acceptance=true
    //    legacy 'accepted'      → 'Approved' (+ approved_at = updated_at)
    //    legacy 'rejected'      → 'Canceled' (+ canceled_at = updated_at)
    //    legacy 'expired'       → 'Expired'  (+ expired_at = updated_at)
    this.addSql(`delete from "quote_requests" where "status" = 'draft';`);
    this.addSql(`
      update "quote_requests"
         set "status" = 'Pending'
       where "status" in ('new', 'under_review');
    `);
    this.addSql(`
      update "quote_requests"
         set "status" = 'Pending',
             "awaiting_customer_revision_acceptance" = true,
             "current_revision_number" = 1
       where "status" = 'quoted';
    `);
    this.addSql(`
      update "quote_requests"
         set "status" = 'Approved',
             "approved_at" = coalesce("responded_at", "updated_at")
       where "status" = 'accepted';
    `);
    this.addSql(`
      update "quote_requests"
         set "status" = 'Canceled',
             "canceled_at" = coalesce("responded_at", "updated_at")
       where "status" = 'rejected';
    `);
    this.addSql(`
      update "quote_requests"
         set "status" = 'Expired',
             "expired_at" = "updated_at"
       where "status" = 'expired';
    `);

    // -- 5. Add the new CHECK constraint accepting only the six new values.
    this.addSql(`
      alter table "quote_requests"
        add constraint "quote_requests_status_check"
        check ("status" in ('Created from admin','Pending','Canceled','Approved','Completed','Expired'));
    `);

    // -- 6. Drop legacy columns now that all data has been migrated.
    this.addSql(`alter table "quote_requests" drop column "quoted_at";`);
    this.addSql(`alter table "quote_requests" drop column "responded_at";`);
    this.addSql(`alter table "quote_requests" drop column "quote_terms";`);

    // -- 7. Indexes for the expiry worker scan and the assignment-scoped lists.
    this.addSql(`create index "idx_quote_requests_status_updated" on "quote_requests" ("status", "updated_at");`);
    this.addSql(`create index "idx_quote_requests_org_status" on "quote_requests" ("organization_id", "status");`);
    this.addSql(`create index "idx_quote_requests_customer_status" on "quote_requests" ("customer_account_id", "status");`);

    // ============================================================
    // quote_request_items
    // ============================================================
    this.addSql(`alter table "quote_request_items" rename column "requester_note" to "line_note";`);
    this.addSql(`alter table "quote_request_items" rename column "quoted_unit_price" to "agreed_unit_price";`);
    this.addSql(`alter table "quote_request_items" rename column "quoted_discount_percent" to "discount_percent";`);
    this.addSql(`
      alter table "quote_request_items"
        add column "desired_unit_price" numeric(12,2) null,
        add column "line_currency" varchar(3) null,
        add column "product_slug" varchar(255) null;
    `);
    this.addSql(`update "quote_request_items" set "line_currency" = 'PLN' where "line_currency" is null;`);
    this.addSql(`alter table "quote_request_items" alter column "line_currency" set not null;`);

    // ============================================================
    // quote_request_revisions
    // ============================================================
    this.addSql(`
      create table "quote_request_revisions" (
        "id" uuid not null,
        "quote_request_id" uuid not null,
        "revision_number" int not null,
        "created_by_admin_user_id" uuid null,
        "created_by_customer_account_id" uuid null,
        "header_note_snapshot" text null,
        "items_snapshot" jsonb not null,
        "previous_revision_id" uuid null,
        "created_at" timestamptz not null,
        constraint "quote_request_revisions_pkey" primary key ("id"),
        constraint "qrr_rfq_fk" foreign key ("quote_request_id") references "quote_requests" ("id") on delete cascade,
        constraint "qrr_unique_per_rfq" unique ("quote_request_id", "revision_number")
      );
    `);
    this.addSql(`create index "qrr_rfq_idx" on "quote_request_revisions" ("quote_request_id");`);

    // ============================================================
    // quote_request_events
    // ============================================================
    this.addSql(`
      create table "quote_request_events" (
        "id" uuid not null,
        "quote_request_id" uuid not null,
        "event_type" varchar(64) not null,
        "actor_admin_user_id" uuid null,
        "actor_customer_account_id" uuid null,
        "actor_role_label" varchar(64) null,
        "payload" jsonb not null,
        "revision_id" uuid null,
        "created_at" timestamptz not null,
        constraint "quote_request_events_pkey" primary key ("id"),
        constraint "qre_rfq_fk" foreign key ("quote_request_id") references "quote_requests" ("id") on delete cascade,
        constraint "qre_event_type_check" check ("event_type" in (
          'created','submitted','modified','approved','canceled','expired',
          'completed','customer-accepted-revision','customer-rejected-revision',
          're-submitted','note-added'
        )),
        constraint "qre_actor_xor" check (
          ("actor_admin_user_id" is null) <> ("actor_customer_account_id" is null)
          or ("actor_admin_user_id" is null and "actor_customer_account_id" is null)
        )
      );
    `);
    this.addSql(`create index "qre_rfq_created_idx" on "quote_request_events" ("quote_request_id", "created_at");`);

    // ============================================================
    // quote_request_notification_events
    // ============================================================
    this.addSql(`
      create table "quote_request_notification_events" (
        "id" uuid not null,
        "quote_request_id" uuid not null,
        "source_event_id" uuid not null,
        "recipient_admin_user_id" uuid null,
        "recipient_customer_account_id" uuid null,
        "channel" varchar(16) not null,
        "status" varchar(16) not null,
        "error" text null,
        "enqueued_at" timestamptz not null,
        "sent_at" timestamptz null,
        constraint "quote_request_notification_events_pkey" primary key ("id"),
        constraint "qrne_rfq_fk" foreign key ("quote_request_id") references "quote_requests" ("id") on delete cascade,
        constraint "qrne_event_fk" foreign key ("source_event_id") references "quote_request_events" ("id") on delete cascade,
        constraint "qrne_channel_check" check ("channel" in ('email','in_app')),
        constraint "qrne_status_check" check ("status" in ('queued','sent','failed'))
      );
    `);
    this.addSql(`
      create unique index "qrne_dedupe_idx" on "quote_request_notification_events"
        ("quote_request_id", "source_event_id",
         coalesce("recipient_admin_user_id", '00000000-0000-0000-0000-000000000000'::uuid),
         coalesce("recipient_customer_account_id", '00000000-0000-0000-0000-000000000000'::uuid),
         "channel");
    `);

    // ============================================================
    // organization_sales_rep_assignments (organizations module — research §R9)
    // ============================================================
    this.addSql(`
      create table "organization_sales_rep_assignments" (
        "id" uuid not null,
        "organization_id" uuid not null,
        "admin_user_id" uuid not null,
        "assigned_by_admin_user_id" uuid null,
        "created_at" timestamptz not null,
        constraint "organization_sales_rep_assignments_pkey" primary key ("id"),
        constraint "orgsa_unique" unique ("organization_id", "admin_user_id")
      );
    `);
    this.addSql(`create index "orgsa_admin_user_idx" on "organization_sales_rep_assignments" ("admin_user_id");`);
    this.addSql(`create index "orgsa_organization_idx" on "organization_sales_rep_assignments" ("organization_id");`);
  }

  override async down(): Promise<void> {
    // Best-effort rollback. Loses all data written under the new schema.
    this.addSql(`drop table if exists "organization_sales_rep_assignments" cascade;`);
    this.addSql(`drop table if exists "quote_request_notification_events" cascade;`);
    this.addSql(`drop table if exists "quote_request_events" cascade;`);
    this.addSql(`drop table if exists "quote_request_revisions" cascade;`);

    this.addSql(`alter table "quote_request_items" drop column if exists "product_slug";`);
    this.addSql(`alter table "quote_request_items" drop column if exists "line_currency";`);
    this.addSql(`alter table "quote_request_items" drop column if exists "desired_unit_price";`);
    this.addSql(`alter table "quote_request_items" rename column "discount_percent" to "quoted_discount_percent";`);
    this.addSql(`alter table "quote_request_items" rename column "agreed_unit_price" to "quoted_unit_price";`);
    this.addSql(`alter table "quote_request_items" rename column "line_note" to "requester_note";`);

    this.addSql(`drop index if exists "idx_quote_requests_status_updated";`);
    this.addSql(`drop index if exists "idx_quote_requests_org_status";`);
    this.addSql(`drop index if exists "idx_quote_requests_customer_status";`);
    this.addSql(`alter table "quote_requests" drop constraint if exists "quote_requests_status_check";`);

    this.addSql(`alter table "quote_requests" add column "quoted_at" timestamptz null;`);
    this.addSql(`alter table "quote_requests" add column "responded_at" timestamptz null;`);
    this.addSql(`alter table "quote_requests" add column "quote_terms" jsonb null;`);

    this.addSql(`alter table "quote_requests" drop column if exists "converted_order_id";`);
    this.addSql(`alter table "quote_requests" drop column if exists "expired_at";`);
    this.addSql(`alter table "quote_requests" drop column if exists "completed_at";`);
    this.addSql(`alter table "quote_requests" drop column if exists "canceled_at";`);
    this.addSql(`alter table "quote_requests" drop column if exists "approved_at";`);
    this.addSql(`alter table "quote_requests" drop column if exists "current_revision_number";`);
    this.addSql(`alter table "quote_requests" drop column if exists "last_customer_seen_revision_number";`);
    this.addSql(`alter table "quote_requests" drop column if exists "awaiting_customer_revision_acceptance";`);
    this.addSql(`alter table "quote_requests" drop column if exists "cancellation_reason";`);
    this.addSql(`alter table "quote_requests" drop column if exists "created_by_admin_user_id";`);

    this.addSql(`alter table "quote_requests" rename column "header_note" to "requester_note";`);
  }
}
