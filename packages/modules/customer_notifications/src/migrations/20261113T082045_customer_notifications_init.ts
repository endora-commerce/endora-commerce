import { Migration } from '@mikro-orm/migrations';

/**
 * The buyer's notification centre — `customer_notifications`
 * (`specs/179-rfq-and-customer-notifications/` data-model §2).
 *
 * One row per entry, addressed to one customer account of one Organization
 * (Principle XI, the D-187 stamped-organisation pattern) and concerning one
 * sales channel or, with `sales_channel_id` null, every channel
 * (Principle XII). `(source_module, source_key)` is the producer's idempotency
 * key.
 *
 * No foreign key to `customer_accounts`, `organizations` or `sales_channels`:
 * those are other modules' tables, and this module must be detachable
 * (Principle I).
 *
 * `created_at` and `read_at` are `timestamptz(3)`, millisecond precision: the
 * storefront list pages by a keyset over `(created_at desc, id desc)` whose
 * cursor carries a JavaScript `Date`, and a column finer than the cursor would
 * let two pages disagree about which entries came before it.
 *
 * Registration is a regeneration: run
 * `pnpm --filter backend run composer:generate` and commit the result. An
 * unregistered migration does not run, and the round-trip guard fails the
 * build for it.
 */
export class Migration20261113T082045CustomerNotificationsInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "customer_notifications" (
        "id" uuid not null,
        "organization_id" uuid not null,
        "customer_account_id" uuid not null,
        "sales_channel_id" uuid null,
        "source_module" varchar(64) not null,
        "source_key" varchar(128) not null,
        "kind" varchar(64) not null,
        "subject_type" varchar(64) null,
        "subject_id" uuid null,
        "title" varchar(255) not null,
        "title_message" jsonb not null,
        "body" text null,
        "body_message" jsonb null,
        "link_path" varchar(512) null,
        "created_at" timestamptz(3) not null default now(),
        "read_at" timestamptz(3) null,
        constraint "customer_notifications_pkey" primary key ("id"),
        constraint "customer_notifications_source_unique" unique ("source_module", "source_key"),
        constraint "customer_notifications_attribution_chk"
          check ("organization_id" is not null and "customer_account_id" is not null),
        constraint "customer_notifications_body_chk"
          check ("body_message" is null or "body" is not null),
        constraint "customer_notifications_link_chk"
          check ("link_path" is null or ("link_path" like '/%' and "link_path" not like '//%'))
      );
    `);
    this.addSql(`
      create index "customer_notifications_reader_idx"
        on "customer_notifications" ("customer_account_id", "created_at" desc, "id" desc);
    `);
    this.addSql(`
      create index "customer_notifications_unread_idx"
        on "customer_notifications" ("customer_account_id", "sales_channel_id")
        where "read_at" is null;
    `);
    this.addSql(`
      create index "customer_notifications_created_idx" on "customer_notifications" ("created_at");
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "customer_notifications";`);
  }
}
