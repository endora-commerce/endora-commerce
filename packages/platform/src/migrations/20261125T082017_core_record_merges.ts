import { Migration } from '@mikro-orm/migrations';

/**
 * The record-merge tables (`specs/192-organization-merge/` data-model §1).
 *
 * `record_merges` is one merge; `record_merge_steps` one participant's part of
 * it; `record_merge_locks` one running merge per record, whose primary key is
 * what makes two racing starts safe. Platform-owned, with no foreign key to any
 * module's table (D-52): survivor and loser are held by value.
 *
 * The partial expression index on `audit_log_entries` serves the merge history
 * drill-down — every Command a merge runs records the merge id in its
 * `state_after` (research R-12) — without adding an audit column.
 *
 * Registration is a regeneration: run
 * `pnpm --filter backend run composer:generate` and commit the result. An
 * unregistered migration does not run, and the round-trip guard fails the
 * build for it.
 *
 * This stamp orders this migration against its own module's migrations and
 * against nothing else. It references no table another module owns.
 */
export class Migration20261125T082017CoreRecordMerges extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "record_merges" (
      "id" uuid not null,
      "host_type" text not null,
      "survivor_id" uuid not null,
      "loser_id" uuid not null,
      "state" text not null default 'running',
      "field_choices" jsonb not null default '{}',
      "custom_field_choices" jsonb not null default '{}',
      "host_context" jsonb not null default '{}',
      "actor_kind" text not null,
      "actor_admin_user_id" uuid null,
      "source" text null,
      "started_at" timestamptz not null default now(),
      "completed_at" timestamptz null,
      "cancelled_at" timestamptz null,
      "needs_attention_at" timestamptz null,
      "finalized_at" timestamptz null,
      "last_error_code" text null,
      "version" int not null default 1,
      constraint "record_merges_pkey" primary key ("id"),
      constraint "record_merges_host_type_check" check ("host_type" in ('organization', 'project')),
      constraint "record_merges_state_check" check ("state" in ('running', 'needs_attention', 'completed', 'cancelled')),
      constraint "record_merges_distinct_records_check" check ("survivor_id" <> "loser_id")
    );`);
    this.addSql(
      `create index if not exists "record_merges_host_survivor_idx" on "record_merges" ("host_type", "survivor_id");`,
    );
    this.addSql(`create index if not exists "record_merges_host_loser_idx" on "record_merges" ("host_type", "loser_id");`);
    this.addSql(
      `create index if not exists "record_merges_open_idx" on "record_merges" ("state") ` +
        `where "state" in ('running', 'needs_attention');`,
    );

    this.addSql(`create table if not exists "record_merge_steps" (
      "merge_id" uuid not null,
      "module_id" text not null,
      "participation_key" text not null,
      "phase" text not null,
      "state" text not null default 'pending',
      "trailing" boolean not null default false,
      "moved_count" bigint not null default 0,
      "batch_count" int not null default 0,
      "attempts" int not null default 0,
      "deferred_reason" text null,
      "last_error_code" text null,
      "last_error_message" text null,
      "started_at" timestamptz null,
      "finished_at" timestamptz null,
      constraint "record_merge_steps_pkey" primary key ("merge_id", "module_id", "participation_key"),
      constraint "record_merge_steps_merge_fk" foreign key ("merge_id") references "record_merges" ("id") on delete cascade,
      constraint "record_merge_steps_state_check" check ("state" in ('pending', 'running', 'done', 'failed', 'deferred')),
      constraint "record_merge_steps_deferred_reason_check" check (
        "deferred_reason" is null or "deferred_reason" in ('module_off', 'module_unavailable')
      )
    );`);
    this.addSql(
      `create index if not exists "record_merge_steps_deferred_idx" on "record_merge_steps" ("module_id") ` +
        `where "state" = 'deferred';`,
    );

    this.addSql(`create table if not exists "record_merge_locks" (
      "host_type" text not null,
      "record_id" uuid not null,
      "merge_id" uuid not null,
      constraint "record_merge_locks_pkey" primary key ("host_type", "record_id"),
      constraint "record_merge_locks_merge_fk" foreign key ("merge_id") references "record_merges" ("id") on delete cascade
    );`);

    this.addSql(
      `create index if not exists "audit_log_entries_merge_id_idx" on "audit_log_entries" ` +
        `(("state_after" ->> 'mergeId')) where "state_after" ? 'mergeId';`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "audit_log_entries_merge_id_idx";`);
    this.addSql(`drop table if exists "record_merge_locks";`);
    this.addSql(`drop table if exists "record_merge_steps";`);
    this.addSql(`drop table if exists "record_merges";`);
  }
}
