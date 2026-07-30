import { Migration } from '@mikro-orm/migrations';

/**
 * PWA module init (feature 046).
 *
 * Four tables owned by the `pwa` module:
 *   - push_subscriptions       — one subscribed device (Web-Push), unique endpoint
 *   - push_messages            — a notification (admin- or event-triggered)
 *   - push_message_deliveries  — (message × subscription) delivery, idempotency unit
 *   - pwa_icon_renditions      — derived icon sizes per channel (global = null channel)
 *
 * PWA identity/toggles are NOT a table — they live in the Settings module
 * (group `pwa`, seeded by the manifest reconciler).
 */
export class Migration20260625T144228PwaInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "push_subscriptions" (
        "id" uuid not null,
        "sales_channel_id" uuid not null,
        "customer_account_id" uuid null,
        "endpoint" text not null,
        "p256dh" text not null,
        "auth" text not null,
        "provider" varchar(32) not null default 'web_push',
        "status" varchar(16) not null default 'active',
        "user_agent" text null,
        "created_at" timestamptz not null,
        "last_seen_at" timestamptz not null,
        constraint "push_subscriptions_pkey" primary key ("id"),
        constraint "push_subscriptions_status_check" check ("status" in ('active', 'invalid'))
      );
    `);
    this.addSql(
      `alter table "push_subscriptions" add constraint "push_subscriptions_endpoint_unique" unique ("endpoint");`,
    );
    this.addSql(
      `create index "push_subscriptions_channel_status_idx" on "push_subscriptions" ("sales_channel_id", "status");`,
    );
    this.addSql(
      `create index "push_subscriptions_customer_idx" on "push_subscriptions" ("customer_account_id") where "customer_account_id" is not null;`,
    );

    this.addSql(`
      create table "push_messages" (
        "id" uuid not null,
        "sales_channel_id" uuid not null,
        "title" varchar(120) not null,
        "body" varchar(500) not null,
        "icon_url" text null,
        "url" text null,
        "audience" jsonb not null,
        "trigger" varchar(32) not null,
        "source_event_id" varchar(128) null,
        "status" varchar(16) not null default 'queued',
        "sent_count" int not null default 0,
        "failed_count" int not null default 0,
        "created_by_admin_user_id" uuid null,
        "created_at" timestamptz not null,
        "sent_at" timestamptz null,
        constraint "push_messages_pkey" primary key ("id"),
        constraint "push_messages_trigger_check" check ("trigger" in ('admin', 'order_status', 'quote_request')),
        constraint "push_messages_status_check" check ("status" in ('queued', 'sending', 'sent', 'failed'))
      );
    `);
    this.addSql(
      `create index "push_messages_channel_created_idx" on "push_messages" ("sales_channel_id", "created_at" desc);`,
    );
    this.addSql(
      `create unique index "push_messages_trigger_event_uniq" on "push_messages" ("trigger", "source_event_id") where "source_event_id" is not null;`,
    );

    this.addSql(`
      create table "push_message_deliveries" (
        "id" uuid not null,
        "message_id" uuid not null,
        "subscription_id" uuid not null,
        "status" varchar(16) not null default 'pending',
        "attempts" int not null default 0,
        "last_error" text null,
        "attempted_at" timestamptz null,
        "created_at" timestamptz not null,
        constraint "push_message_deliveries_pkey" primary key ("id"),
        constraint "push_message_deliveries_status_check" check ("status" in ('pending', 'sent', 'failed', 'pruned'))
      );
    `);
    this.addSql(
      `alter table "push_message_deliveries" add constraint "push_message_deliveries_message_id_foreign" foreign key ("message_id") references "push_messages" ("id") on update cascade on delete cascade;`,
    );
    this.addSql(
      `alter table "push_message_deliveries" add constraint "push_message_deliveries_subscription_id_foreign" foreign key ("subscription_id") references "push_subscriptions" ("id") on update cascade on delete cascade;`,
    );
    this.addSql(
      `alter table "push_message_deliveries" add constraint "push_message_deliveries_msg_sub_unique" unique ("message_id", "subscription_id");`,
    );
    this.addSql(
      `create index "push_message_deliveries_status_idx" on "push_message_deliveries" ("status");`,
    );

    this.addSql(`
      create table "pwa_icon_renditions" (
        "id" uuid not null,
        "sales_channel_id" uuid null,
        "source_asset_id" uuid not null,
        "size" int not null,
        "purpose" varchar(16) not null,
        "asset_id" uuid not null,
        "content_hash" varchar(64) not null,
        "created_at" timestamptz not null,
        constraint "pwa_icon_renditions_pkey" primary key ("id"),
        constraint "pwa_icon_renditions_purpose_check" check ("purpose" in ('any', 'maskable'))
      );
    `);
    // One rendition per (size, purpose) per scope. Two partial unique indexes so
    // the rule holds for both per-channel rows and the single global (null-channel)
    // row without relying on PG15-only NULLS NOT DISTINCT.
    this.addSql(
      `create unique index "pwa_icon_renditions_channel_size_purpose_uniq" on "pwa_icon_renditions" ("sales_channel_id", "size", "purpose") where "sales_channel_id" is not null;`,
    );
    this.addSql(
      `create unique index "pwa_icon_renditions_global_size_purpose_uniq" on "pwa_icon_renditions" ("size", "purpose") where "sales_channel_id" is null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "pwa_icon_renditions" cascade;`);
    this.addSql(`drop table if exists "push_message_deliveries" cascade;`);
    this.addSql(`drop table if exists "push_messages" cascade;`);
    this.addSql(`drop table if exists "push_subscriptions" cascade;`);
  }
}
