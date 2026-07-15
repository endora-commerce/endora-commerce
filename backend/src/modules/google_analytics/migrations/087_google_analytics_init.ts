import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 049 — Google Analytics.
 *
 * Creates `ga_custom_events`: admin-defined mappings from a storefront trigger
 * action to a named GA4 event, with the selected payload fields stored inline
 * as JSONB (research §R9 / data-model simplification). Per-channel config lives
 * in the Settings module (no table). `sales_channel_id` null ⇒ all channels.
 */
export class Migration087GoogleAnalyticsInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "ga_custom_events" (
        "id" uuid not null,
        "sales_channel_id" uuid null,
        "event_name" varchar(40) not null,
        "trigger_action" varchar(32) not null,
        "button_id" varchar(128) null,
        "enabled" boolean not null default true,
        "fields" jsonb not null default '[]',
        "version" int not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "ga_custom_events_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `create index "ga_custom_events_channel_action_idx" on "ga_custom_events" ("sales_channel_id", "trigger_action");`,
    );
    this.addSql(
      `alter table "ga_custom_events" add constraint "ga_custom_events_sales_channel_id_foreign" ` +
        `foreign key ("sales_channel_id") references "sales_channels" ("id") on update cascade on delete cascade;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "ga_custom_events" cascade;`);
  }
}
