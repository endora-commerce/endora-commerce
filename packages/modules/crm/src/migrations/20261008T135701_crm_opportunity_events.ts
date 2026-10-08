import { Migration } from '@mikro-orm/migrations';

/**
 * User Stories 21 and 22 of `specs/143-crm-sales-opportunities/` — Events on
 * an Opportunity, their reminders and the Calendar (`data-model.md`
 * § *`crm_opportunity_events`*).
 *
 * One table, a child of `crm_opportunities` like the seven others: no tenant
 * column of its own, and gone with its Opportunity (`on delete cascade`).
 * `created_by_admin_user_id` is a value with no foreign key, as every
 * admin-user reference of this module is, so no other module's table is
 * referenced.
 *
 * Three indexes, one per reader:
 *
 * - `(opportunity_id, starts_at)` — the Events tab's list and the detail's count;
 * - `(starts_at)` — the Calendar's range read. An Event is at most 25 hours
 *   long, so the read bounds `starts_at` from below as well and this index is
 *   its whole candidate set;
 * - `(remind_at)`, **partial** — the reminders still to do, which is what the
 *   sweep reads every minute. It holds nothing once a reminder is handled.
 */
export class Migration20261008T135701CrmOpportunityEvents extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "crm_opportunity_events" (
        "id" uuid not null,
        "opportunity_id" uuid not null,
        "name" varchar(200) not null,
        "description" text null,
        "all_day" boolean not null default false,
        "starts_at" timestamptz not null,
        "ends_at" timestamptz not null,
        "time_zone" varchar(64) not null,
        "remind_at" timestamptz null,
        "reminder_handled_at" timestamptz null,
        "reminder_outcome" varchar(16) null,
        "created_by_admin_user_id" uuid null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "crm_opportunity_events_pkey" primary key ("id"),
        constraint "crm_opportunity_events_opportunity_fk" foreign key ("opportunity_id")
          references "crm_opportunities" ("id") on delete cascade,
        constraint "crm_opportunity_events_ends_after_start_check" check ("ends_at" > "starts_at"),
        constraint "crm_opportunity_events_reminder_outcome_check" check (
          "reminder_outcome" in (
            'sending', 'bell', 'bell_email', 'email', 'no_recipient', 'undeliverable', 'missed', 'interrupted'
          )
        )
      );
    `);
    this.addSql(
      `create index "crm_opportunity_events_opportunity_id_starts_at_index" on "crm_opportunity_events" ("opportunity_id", "starts_at");`,
    );
    this.addSql(
      `create index "crm_opportunity_events_starts_at_index" on "crm_opportunity_events" ("starts_at");`,
    );
    this.addSql(`
      create index "crm_opportunity_events_reminder_due_index" on "crm_opportunity_events" ("remind_at")
        where "remind_at" is not null and "reminder_handled_at" is null;
    `);
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "crm_opportunity_events" cascade;');
  }
}
