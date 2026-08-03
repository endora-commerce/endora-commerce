import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 067 — Product Feed module (runs, issues, artefacts).
 *
 * Creates:
 *  - `product_feed_runs` — one generation attempt, with the counters, the
 *    template snapshot and the heartbeat the reaper reads (data-model §4).
 *  - `product_feed_artefacts` — one generated file (data-model §7).
 *  - `product_feed_run_issues` — per-item skip/warning records (data-model §6).
 *    `product_id` / `variant_id` carry **no** foreign key on purpose: run
 *    history must survive product deletion.
 *
 * Also adds the three deferred pointer foreign keys on `product_feeds`
 * (`published_artefact_id`, `current_run_id`, `last_run_id`), which could not
 * be declared in the init migration because their target tables did not exist
 * yet. All three are `on delete set null`, so purging history never deletes a
 * feed.
 */
export class Migration20260802T073627ProductFeedsRuns extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "product_feed_runs" (
        "id" uuid not null,
        "product_feed_id" uuid not null,
        "trigger" varchar(16) not null,
        "triggered_by_admin_user_id" uuid null,
        "status" varchar(24) not null default 'queued',
        "template_snapshot" jsonb null,
        "started_at" timestamptz null,
        "finished_at" timestamptz null,
        "heartbeat_at" timestamptz null,
        "considered_count" int not null default 0,
        "emitted_count" int not null default 0,
        "skipped_count" int not null default 0,
        "warning_count" int not null default 0,
        "issue_overflow" boolean not null default false,
        "failure_code" varchar(48) null,
        "failure_detail" text null,
        "skip_reason" varchar(48) null,
        "artefact_id" uuid null,
        "duration_ms" int null,
        "created_at" timestamptz not null,
        constraint "product_feed_runs_pkey" primary key ("id"),
        constraint "product_feed_runs_feed_fk"
          foreign key ("product_feed_id") references "product_feeds" ("id")
          on update cascade on delete cascade,
        constraint "product_feed_runs_admin_user_fk"
          foreign key ("triggered_by_admin_user_id") references "admin_users" ("id")
          on update cascade on delete set null
      );
    `);
    this.addSql(
      `create index "product_feed_runs_feed_created_idx" on "product_feed_runs" ("product_feed_id", "created_at" desc);`,
    );
    this.addSql(
      `create index "product_feed_runs_running_idx" on "product_feed_runs" ("status") where "status" = 'running';`,
    );

    this.addSql(`
      create table "product_feed_artefacts" (
        "id" uuid not null,
        "product_feed_id" uuid not null,
        "feed_run_id" uuid not null,
        "kind" varchar(16) not null default 'feed',
        "storage_backend" varchar(16) not null,
        "storage_locator" varchar(512) not null,
        "content_type" varchar(127) not null,
        "byte_size" bigint not null,
        "item_count" int not null default 0,
        "checksum_sha256" char(64) null,
        "produced_at" timestamptz not null,
        "created_at" timestamptz not null,
        constraint "product_feed_artefacts_pkey" primary key ("id"),
        constraint "product_feed_artefacts_feed_fk"
          foreign key ("product_feed_id") references "product_feeds" ("id")
          on update cascade on delete cascade,
        constraint "product_feed_artefacts_run_fk"
          foreign key ("feed_run_id") references "product_feed_runs" ("id")
          on update cascade on delete cascade
      );
    `);
    this.addSql(
      `create index "product_feed_artefacts_feed_kind_produced_idx" on "product_feed_artefacts" ("product_feed_id", "kind", "produced_at" desc);`,
    );

    this.addSql(`
      create table "product_feed_run_issues" (
        "id" uuid not null,
        "feed_run_id" uuid not null,
        "severity" varchar(8) not null,
        "reason" varchar(48) not null,
        "product_id" uuid null,
        "variant_id" uuid null,
        "sku" varchar(64) null,
        "output_name" varchar(128) null,
        "detail" varchar(255) null,
        "created_at" timestamptz not null,
        constraint "product_feed_run_issues_pkey" primary key ("id"),
        constraint "product_feed_run_issues_run_fk"
          foreign key ("feed_run_id") references "product_feed_runs" ("id")
          on update cascade on delete cascade
      );
    `);
    this.addSql(
      `create index "product_feed_run_issues_run_severity_idx" on "product_feed_run_issues" ("feed_run_id", "severity");`,
    );

    // A run points at the artefact it produced; the pointer survives a purge.
    this.addSql(`
      alter table "product_feed_runs"
        add constraint "product_feed_runs_artefact_fk"
        foreign key ("artefact_id") references "product_feed_artefacts" ("id")
        on update cascade on delete set null;
    `);

    // The three deferred pointers on the feed itself.
    this.addSql(`
      alter table "product_feeds"
        add constraint "product_feeds_published_artefact_fk"
        foreign key ("published_artefact_id") references "product_feed_artefacts" ("id")
        on update cascade on delete set null;
    `);
    this.addSql(`
      alter table "product_feeds"
        add constraint "product_feeds_current_run_fk"
        foreign key ("current_run_id") references "product_feed_runs" ("id")
        on update cascade on delete set null;
    `);
    this.addSql(`
      alter table "product_feeds"
        add constraint "product_feeds_last_run_fk"
        foreign key ("last_run_id") references "product_feed_runs" ("id")
        on update cascade on delete set null;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "product_feeds" drop constraint if exists "product_feeds_last_run_fk";`,
    );
    this.addSql(
      `alter table "product_feeds" drop constraint if exists "product_feeds_current_run_fk";`,
    );
    this.addSql(
      `alter table "product_feeds" drop constraint if exists "product_feeds_published_artefact_fk";`,
    );
    this.addSql(`drop table if exists "product_feed_run_issues" cascade;`);
    this.addSql(`drop table if exists "product_feed_artefacts" cascade;`);
    this.addSql(`drop table if exists "product_feed_runs" cascade;`);
  }
}
