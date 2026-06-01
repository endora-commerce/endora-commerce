import { Migration } from '@mikro-orm/migrations';

/**
 * Admin notifications — minimal "bell" surface introduced by feature 026.
 *
 * One row per notification. `audience='all_admins'` rows are visible to
 * every admin (the read state is tracked per-admin in a future iteration
 * via `admin_notification_reads`; for the first iteration we keep `read_at`
 * on the row itself for `audience='admin_user'` rows only, and rely on the
 * `mark-all-read` endpoint stamping a per-admin "last seen" cursor —
 * implemented in code, not in this schema).
 *
 * Unread cap is enforced by application code (`pruneStale()`), not by the
 * schema.
 */
export class Migration048AdminNotificationsInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "admin_notifications" (
        "id" uuid not null,
        "audience" varchar(16) not null,
        "target_admin_user_id" uuid null,
        "kind" varchar(64) not null,
        "subject_type" varchar(64) null,
        "subject_id" uuid null,
        "title" varchar(255) not null,
        "body" text null,
        "link_path" varchar(255) null,
        "created_at" timestamptz not null default now(),
        "read_at" timestamptz null,
        "archived_at" timestamptz null,
        constraint "admin_notifications_pkey" primary key ("id"),
        constraint "admin_notifications_audience_check"
          check ("audience" in ('all_admins', 'admin_user')),
        constraint "admin_notifications_target_consistency_check"
          check (
            ("audience" = 'all_admins' and "target_admin_user_id" is null)
            or ("audience" = 'admin_user' and "target_admin_user_id" is not null)
          ),
        constraint "admin_notifications_target_admin_user_fk"
          foreign key ("target_admin_user_id") references "admin_users" ("id") on delete cascade
      );
    `);

    // Feed query: most-recent first, filtered by audience + (optionally)
    // target admin.
    this.addSql(`
      create index "admin_notifications_audience_idx"
        on "admin_notifications" ("audience", "target_admin_user_id", "created_at" desc);
    `);

    // Partial index for the unread-count fast path.
    this.addSql(`
      create index "admin_notifications_unread_idx"
        on "admin_notifications" ("audience", "target_admin_user_id")
        where "read_at" is null and "archived_at" is null;
    `);

    // Per-admin read cursor for `audience='all_admins'` rows.
    // (Each admin marks their own copy of a broadcast notification as read.)
    this.addSql(`
      create table "admin_notification_reads" (
        "notification_id" uuid not null,
        "admin_user_id" uuid not null,
        "read_at" timestamptz not null default now(),
        constraint "admin_notification_reads_pkey"
          primary key ("notification_id", "admin_user_id"),
        constraint "admin_notification_reads_notification_fk"
          foreign key ("notification_id") references "admin_notifications" ("id") on delete cascade,
        constraint "admin_notification_reads_admin_user_fk"
          foreign key ("admin_user_id") references "admin_users" ("id") on delete cascade
      );
    `);

    this.addSql(`
      create index "admin_notification_reads_admin_user_idx"
        on "admin_notification_reads" ("admin_user_id");
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "admin_notification_reads" cascade;`);
    this.addSql(`drop index if exists "admin_notifications_audience_idx";`);
    this.addSql(`drop index if exists "admin_notifications_unread_idx";`);
    this.addSql(`drop table if exists "admin_notifications" cascade;`);
  }
}
