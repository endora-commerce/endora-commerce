import { Migration } from '@mikro-orm/migrations';

/**
 * Feed delivery — feature 070, the configuration and its attempt history.
 *
 * Two tables, both owned by `product_feeds`:
 *
 *  - `product_feed_deliveries` — at most one per feed. The unique constraint on
 *    `product_feed_id` is FR-100 itself: "a feed MAY carry at most one delivery
 *    configuration" enforced where two concurrent writes cannot both pass it.
 *    The columns are nullable per protocol rather than a JSONB blob because
 *    there are three fixed protocols, not an open set, and these values are read
 *    and validated individually.
 *  - `product_feed_delivery_attempts` — FR-105. Append-only; a failed attempt is
 *    recorded as fully as a successful one, because an empty history and a
 *    history of five failures look identical if only successes are written.
 *
 * **No secret column anywhere.** `credential_code` is a pointer into the
 * `credentials` module, which owns encryption at rest and masking on read
 * (FR-107). It is deliberately NOT a foreign key: a credential is addressed by
 * its stable code, and deleting one in use should produce the credentials
 * module's own `CREDENTIAL_IN_USE` sentence rather than a constraint name. The
 * only foreign keys here are to this module's own tables, so the manifest gains
 * `credentials` as a *service* dependency, not an FK-driven one — the shape
 * `pim_ergonode` already carries.
 *
 * `on delete cascade` from the feed on both tables: deleting a feed must not
 * leave a delivery target pointing at nothing, and its attempt history is only
 * meaningful as that feed's history.
 */
export class Migration20260806T125806ProductFeedsDelivery extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "product_feed_deliveries" (
        "id" uuid not null,
        "product_feed_id" uuid not null,
        "enabled" boolean not null default false,
        "protocol" varchar(16) not null,
        "http_label" varchar(32) null,
        "host" varchar(255) null,
        "port" integer null,
        "username" varchar(255) null,
        "directory_path" varchar(1024) null,
        "passive_mode" boolean not null default true,
        "request_url" text null,
        "headers" jsonb not null default '{}'::jsonb,
        "credential_code" varchar(64) not null,
        "version" integer not null default 1,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "product_feed_deliveries_pkey" primary key ("id")
      );
    `);
    this.addSql(`
      alter table "product_feed_deliveries"
        add constraint "product_feed_deliveries_product_feed_id_unique"
        unique ("product_feed_id");
    `);
    this.addSql(`
      alter table "product_feed_deliveries"
        add constraint "product_feed_deliveries_product_feed_id_foreign"
        foreign key ("product_feed_id") references "product_feeds" ("id") on delete cascade;
    `);

    this.addSql(`
      create table "product_feed_delivery_attempts" (
        "id" uuid not null,
        "product_feed_id" uuid not null,
        "feed_run_id" uuid null,
        "feed_artefact_id" uuid null,
        "protocol" varchar(16) not null,
        "target" varchar(512) not null,
        "status" varchar(16) not null,
        "failure_reason" varchar(32) null,
        "failure_detail" varchar(2048) null,
        "attempt" integer not null default 1,
        "is_test" boolean not null default false,
        "started_at" timestamptz not null default now(),
        "finished_at" timestamptz null,
        "duration_ms" integer null,
        "created_at" timestamptz not null default now(),
        constraint "product_feed_delivery_attempts_pkey" primary key ("id")
      );
    `);
    this.addSql(`
      alter table "product_feed_delivery_attempts"
        add constraint "product_feed_delivery_attempts_product_feed_id_foreign"
        foreign key ("product_feed_id") references "product_feeds" ("id") on delete cascade;
    `);
    // The one query the admin history runs: this feed's attempts, newest first.
    this.addSql(`
      create index "product_feed_delivery_attempts_feed_started_index"
        on "product_feed_delivery_attempts" ("product_feed_id", "started_at" desc);
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "product_feed_delivery_attempts" cascade;`);
    this.addSql(`drop table if exists "product_feed_deliveries" cascade;`);
  }
}
