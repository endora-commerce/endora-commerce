import { Migration } from '@mikro-orm/migrations';

/**
 * Quote request notification records, redesigned —
 * `specs/179-rfq-and-customer-notifications/` data-model §1, research R-7 and
 * R-21 (issue #238).
 *
 * Drops `quote_request_notification_events`, which was written on every
 * transition and read by nothing, and creates `quote_request_notifications`:
 * one delivery record per (source history entry, recipient, channel), the
 * queue the delivery worker claims from and what the request's History shows.
 *
 * **No data is carried over** (owner ruling, 2026-11-12: no compatibility).
 * The old rows were never delivered, the recipient columns do not map onto the
 * new channels, and every one of them is older than the 24-hour limit a
 * delivery may still go out within.
 *
 * Both foreign keys point at this module's own tables; `recipient_id` names an
 * `admin_users` or a `customer_accounts` row and has no foreign key, because
 * those are other modules' tables.
 *
 * `down()` drops the new table and re-creates the old one, empty, with the
 * shape `Migration20260503T141344QuoteRequestsWorkflow` gave it — for a
 * development rollback; the records written since are lost.
 */
export class Migration20261113T081826QuoteRequestsNotificationsRedesign extends Migration {
  override async up(): Promise<void> {
    this.addSql(`drop table if exists "quote_request_notification_events" cascade;`);
    this.addSql(`
      create table "quote_request_notifications" (
        "id" uuid not null,
        "organization_id" uuid not null,
        "quote_request_id" uuid not null,
        "source_event_id" uuid not null,
        "change" varchar(32) not null,
        "recipient_kind" varchar(16) not null,
        "recipient_id" uuid not null,
        "channel" varchar(24) not null,
        "status" varchar(32) not null default 'pending',
        "attempts" integer not null default 0,
        "next_attempt_at" timestamptz not null default now(),
        "last_error" text null,
        "source_occurred_at" timestamptz not null,
        "created_at" timestamptz not null default now(),
        "closed_at" timestamptz null,
        constraint "quote_request_notifications_pkey" primary key ("id"),
        constraint "quote_request_notifications_rfq_fk"
          foreign key ("quote_request_id") references "quote_requests" ("id") on delete cascade,
        constraint "quote_request_notifications_event_fk"
          foreign key ("source_event_id") references "quote_request_events" ("id") on delete cascade,
        constraint "quote_request_notifications_unique"
          unique ("source_event_id", "recipient_kind", "recipient_id", "channel"),
        constraint "quote_request_notifications_status_chk" check ("status" in (
          'pending', 'sent', 'skipped_stale', 'skipped_module_off', 'skipped_deactivated',
          'skipped_no_transport', 'skipped_logged', 'skipped_no_recipient', 'skipped_preference',
          'skipped_no_subscription', 'failed'
        )),
        constraint "quote_request_notifications_channel_chk" check ("channel" in (
          'admin_in_app', 'admin_email', 'customer_email', 'customer_in_app', 'customer_push'
        )),
        constraint "quote_request_notifications_recipient_kind_chk" check ("recipient_kind" in ('admin', 'customer')),
        constraint "quote_request_notifications_channel_side_chk" check (
          ("recipient_kind" = 'admin' and "channel" in ('admin_in_app', 'admin_email'))
          or ("recipient_kind" = 'customer' and "channel" in ('customer_email', 'customer_in_app', 'customer_push'))
        ),
        constraint "quote_request_notifications_closed_chk" check (("status" = 'pending') = ("closed_at" is null))
      );
    `);
    // The worker's claim: the pending records that are due, oldest first.
    this.addSql(`
      create index "quote_request_notifications_due_idx" on "quote_request_notifications" ("next_attempt_at")
        where "status" = 'pending';
    `);
    // The History read: a request's records, grouped by the entry they announce.
    this.addSql(`
      create index "quote_request_notifications_request_idx" on "quote_request_notifications"
        ("quote_request_id", "source_event_id");
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "quote_request_notifications" cascade;`);
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
  }
}
