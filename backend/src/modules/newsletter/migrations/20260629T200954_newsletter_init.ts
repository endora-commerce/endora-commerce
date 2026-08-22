import { Migration } from '@mikro-orm/migrations';
import { randomUUID } from 'crypto';
import { defaultHeaderTree } from '@endora-commerce/email-components/defaults/default-header';
import { defaultFooterTree, envelopeFromTree } from '@endora-commerce/email-components/defaults/default-footer';

/**
 * Feature 048 — Newsletter.
 *
 * Creates the full module schema: subscribers + tags + custom fields +
 * suppressions, reusable email blocks (+ channel bridge), campaigns (+ group
 * bridge), per-recipient send records (with the atomic-claim partial unique
 * indexes that make dispatch idempotent under N≥2 workers — Principle X),
 * engagement events, and automations (+ runs, with the `once` re-entry partial
 * unique index). Seeds the system default header/footer blocks (FR-020/026).
 */
const DEFAULT_LANGUAGES = ['en-US', 'pl-PL'];
const NEWSLETTER_DEFAULT_HEADER_CODE = 'newsletter_default_header';
const NEWSLETTER_DEFAULT_FOOTER_CODE = 'newsletter_default_footer';

function jsonbLiteral(value: unknown): string {
  return JSON.stringify(value).replace(/'/g, "''");
}

export class Migration20260629T200954NewsletterInit extends Migration {
  override async up(): Promise<void> {
    // --- Subscribers -------------------------------------------------------
    this.addSql(`
      create table "newsletter_subscribers" (
        "id" uuid not null,
        "email" varchar(320) not null,
        "status" varchar(16) not null default 'pending',
        "source" varchar(64) null,
        "sales_channel_id" uuid null,
        "customer_account_id" uuid null,
        "custom_fields" jsonb not null default '{}',
        "consent_at" timestamptz null,
        "confirmed_at" timestamptz null,
        "unsubscribed_at" timestamptz null,
        "unsubscribe_reason" text null,
        "deactivated_at" timestamptz null,
        "version" int not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "newsletter_subscribers_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `alter table "newsletter_subscribers" add constraint "newsletter_subscribers_email_unique" unique ("email");`,
    );
    this.addSql(`create index "newsletter_subscribers_status_idx" on "newsletter_subscribers" ("status");`);
    this.addSql(
      `create index "newsletter_subscribers_channel_idx" on "newsletter_subscribers" ("sales_channel_id");`,
    );
    this.addSql(
      `create index "newsletter_subscribers_custom_fields_idx" on "newsletter_subscribers" using gin ("custom_fields");`,
    );

    // --- Tags + bridge -----------------------------------------------------
    this.addSql(`
      create table "newsletter_tags" (
        "id" uuid not null,
        "code" varchar(64) not null,
        "name" varchar(160) not null,
        "description" text null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "newsletter_tags_pkey" primary key ("id")
      );
    `);
    this.addSql(`alter table "newsletter_tags" add constraint "newsletter_tags_code_unique" unique ("code");`);
    this.addSql(`
      create table "newsletter_subscriber_tags" (
        "subscriber_id" uuid not null,
        "tag_id" uuid not null,
        constraint "newsletter_subscriber_tags_pkey" primary key ("subscriber_id", "tag_id")
      );
    `);
    this.addSql(
      `alter table "newsletter_subscriber_tags" add constraint "nst_subscriber_fk" ` +
        `foreign key ("subscriber_id") references "newsletter_subscribers" ("id") on delete cascade;`,
    );
    this.addSql(
      `alter table "newsletter_subscriber_tags" add constraint "nst_tag_fk" ` +
        `foreign key ("tag_id") references "newsletter_tags" ("id") on delete cascade;`,
    );
    this.addSql(`create index "nst_tag_idx" on "newsletter_subscriber_tags" ("tag_id");`);

    // --- Custom fields -----------------------------------------------------
    this.addSql(`
      create table "newsletter_custom_fields" (
        "id" uuid not null,
        "key" varchar(64) not null,
        "label" varchar(160) not null,
        "type" varchar(16) not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "newsletter_custom_fields_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `alter table "newsletter_custom_fields" add constraint "newsletter_custom_fields_key_unique" unique ("key");`,
    );

    // --- Suppressions ------------------------------------------------------
    this.addSql(`
      create table "newsletter_suppressions" (
        "id" uuid not null,
        "email" varchar(320) not null,
        "reason" varchar(16) not null,
        "detail" text null,
        "created_at" timestamptz not null,
        constraint "newsletter_suppressions_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `alter table "newsletter_suppressions" add constraint "newsletter_suppressions_email_unique" unique ("email");`,
    );

    // --- Email blocks + bridge ---------------------------------------------
    this.addSql(`
      create table "newsletter_email_blocks" (
        "id" uuid not null,
        "code" varchar(180) not null,
        "name" varchar(200) not null,
        "description" text null,
        "active" boolean not null default true,
        "content" jsonb not null default '{}',
        "is_system" boolean not null default false,
        "version" int not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "newsletter_email_blocks_pkey" primary key ("id")
      );
    `);
    this.addSql(`create index "newsletter_email_blocks_code_idx" on "newsletter_email_blocks" ("code");`);
    this.addSql(`
      create table "newsletter_email_block_sales_channels" (
        "block_id" uuid not null,
        "sales_channel_id" uuid not null,
        "code" varchar(180) not null,
        constraint "newsletter_ebsc_pkey" primary key ("block_id", "sales_channel_id")
      );
    `);
    this.addSql(
      `alter table "newsletter_email_block_sales_channels" add constraint "newsletter_ebsc_block_fk" ` +
        `foreign key ("block_id") references "newsletter_email_blocks" ("id") on delete cascade;`,
    );
    this.addSql(
      `create unique index "newsletter_ebsc_channel_code_unique" on "newsletter_email_block_sales_channels" ("sales_channel_id", "code");`,
    );

    // --- Campaigns + group bridge ------------------------------------------
    this.addSql(`
      create table "newsletter_campaigns" (
        "id" uuid not null,
        "name" varchar(200) not null,
        "subject" text not null,
        "content" jsonb not null default '{}',
        "sales_channel_id" uuid null,
        "language" varchar(12) not null,
        "target_type" varchar(16) not null default 'all',
        "target_tag_ids" jsonb not null default '[]',
        "tracking_enabled" boolean not null default true,
        "status" varchar(16) not null default 'draft',
        "scheduled_at" timestamptz null,
        "dispatch_job_id" varchar(128) null,
        "stats" jsonb not null default '{}',
        "version" int not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "newsletter_campaigns_pkey" primary key ("id")
      );
    `);
    this.addSql(`create index "newsletter_campaigns_status_idx" on "newsletter_campaigns" ("status");`);
    this.addSql(`
      create table "newsletter_campaign_subscribers" (
        "campaign_id" uuid not null,
        "subscriber_id" uuid not null,
        constraint "newsletter_campaign_subscribers_pkey" primary key ("campaign_id", "subscriber_id")
      );
    `);
    this.addSql(
      `alter table "newsletter_campaign_subscribers" add constraint "ncs_campaign_fk" ` +
        `foreign key ("campaign_id") references "newsletter_campaigns" ("id") on delete cascade;`,
    );
    this.addSql(
      `alter table "newsletter_campaign_subscribers" add constraint "ncs_subscriber_fk" ` +
        `foreign key ("subscriber_id") references "newsletter_subscribers" ("id") on delete cascade;`,
    );

    // --- Automations + runs ------------------------------------------------
    this.addSql(`
      create table "newsletter_automations" (
        "id" uuid not null,
        "name" varchar(200) not null,
        "status" varchar(16) not null default 'draft',
        "trigger_type" varchar(16) not null default 'all',
        "trigger_tag_ids" jsonb not null default '[]',
        "sales_channel_id" uuid null,
        "language" varchar(12) not null,
        "reentry_policy" varchar(16) not null default 'once',
        "steps" jsonb not null default '[]',
        "version" int not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "newsletter_automations_pkey" primary key ("id")
      );
    `);
    this.addSql(`
      create table "newsletter_automation_runs" (
        "id" uuid not null,
        "automation_id" uuid not null,
        "subscriber_id" uuid not null,
        "current_step" int not null default 0,
        "status" varchar(16) not null default 'active',
        "next_step_at" timestamptz null,
        "next_step_job_id" varchar(128) null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "newsletter_automation_runs_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `alter table "newsletter_automation_runs" add constraint "nar_automation_fk" ` +
        `foreign key ("automation_id") references "newsletter_automations" ("id") on delete cascade;`,
    );
    this.addSql(
      `alter table "newsletter_automation_runs" add constraint "nar_subscriber_fk" ` +
        `foreign key ("subscriber_id") references "newsletter_subscribers" ("id") on delete cascade;`,
    );
    this.addSql(`create index "nar_automation_idx" on "newsletter_automation_runs" ("automation_id");`);
    this.addSql(
      `create unique index "nar_once_unique" on "newsletter_automation_runs" ("automation_id", "subscriber_id") where "status" <> 'cancelled';`,
    );

    // --- Send records (atomic claim) + engagement events -------------------
    this.addSql(`
      create table "newsletter_send_records" (
        "id" uuid not null,
        "campaign_id" uuid null,
        "automation_run_id" uuid null,
        "step_index" int null,
        "subscriber_id" uuid not null,
        "status" varchar(16) not null default 'queued',
        "provider_message_id" varchar(255) null,
        "error" text null,
        "opened_at" timestamptz null,
        "click_count" int not null default 0,
        "sent_at" timestamptz null,
        "created_at" timestamptz not null,
        constraint "newsletter_send_records_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `alter table "newsletter_send_records" add constraint "nsr_subscriber_fk" ` +
        `foreign key ("subscriber_id") references "newsletter_subscribers" ("id") on delete cascade;`,
    );
    this.addSql(`create index "nsr_subscriber_idx" on "newsletter_send_records" ("subscriber_id");`);
    this.addSql(`create index "nsr_status_idx" on "newsletter_send_records" ("status");`);
    this.addSql(
      `create unique index "nsr_campaign_claim_unique" on "newsletter_send_records" ("campaign_id", "subscriber_id") where "campaign_id" is not null;`,
    );
    this.addSql(
      `create unique index "nsr_automation_claim_unique" on "newsletter_send_records" ("automation_run_id", "step_index", "subscriber_id") where "automation_run_id" is not null;`,
    );

    this.addSql(`
      create table "newsletter_engagement_events" (
        "id" uuid not null,
        "send_record_id" uuid not null,
        "type" varchar(8) not null,
        "link_id" varchar(64) null,
        "url" text null,
        "occurred_at" timestamptz not null,
        constraint "newsletter_engagement_events_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `alter table "newsletter_engagement_events" add constraint "nee_send_record_fk" ` +
        `foreign key ("send_record_id") references "newsletter_send_records" ("id") on delete cascade;`,
    );
    this.addSql(`create index "nee_send_record_idx" on "newsletter_engagement_events" ("send_record_id");`);
    this.addSql(`create index "nee_type_idx" on "newsletter_engagement_events" ("type");`);

    // --- Seed system default header + footer blocks (FR-020/026) -----------
    const header = envelopeFromTree(defaultHeaderTree(), DEFAULT_LANGUAGES);
    const footer = envelopeFromTree(defaultFooterTree(), DEFAULT_LANGUAGES);
    this.addSql(
      `insert into "newsletter_email_blocks" ("id", "code", "name", "active", "content", "is_system", "version", "created_at", "updated_at") ` +
        `values ('${randomUUID()}', '${NEWSLETTER_DEFAULT_HEADER_CODE}', 'Newsletter default header', true, '${jsonbLiteral(header)}'::jsonb, true, 1, now(), now());`,
    );
    this.addSql(
      `insert into "newsletter_email_blocks" ("id", "code", "name", "active", "content", "is_system", "version", "created_at", "updated_at") ` +
        `values ('${randomUUID()}', '${NEWSLETTER_DEFAULT_FOOTER_CODE}', 'Newsletter default footer', true, '${jsonbLiteral(footer)}'::jsonb, true, 1, now(), now());`,
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "newsletter_engagement_events" cascade;');
    this.addSql('drop table if exists "newsletter_send_records" cascade;');
    this.addSql('drop table if exists "newsletter_automation_runs" cascade;');
    this.addSql('drop table if exists "newsletter_automations" cascade;');
    this.addSql('drop table if exists "newsletter_campaign_subscribers" cascade;');
    this.addSql('drop table if exists "newsletter_campaigns" cascade;');
    this.addSql('drop table if exists "newsletter_email_block_sales_channels" cascade;');
    this.addSql('drop table if exists "newsletter_email_blocks" cascade;');
    this.addSql('drop table if exists "newsletter_suppressions" cascade;');
    this.addSql('drop table if exists "newsletter_custom_fields" cascade;');
    this.addSql('drop table if exists "newsletter_subscriber_tags" cascade;');
    this.addSql('drop table if exists "newsletter_tags" cascade;');
    this.addSql('drop table if exists "newsletter_subscribers" cascade;');
  }
}
