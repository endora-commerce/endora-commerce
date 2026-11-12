import { Migration } from '@mikro-orm/migrations';

/**
 * The `command_outbox` table (`specs/176-command-hooks-outbox/` FR-030,
 * `data-model.md` §1).
 *
 * One row per (Command execution, present `afterCommit` handler), written by the
 * Command Bus on the Command's own transaction and delivered at least once by
 * the drain `_lifecycle` attaches. Platform-owned and global, like
 * `audit_log_entries`: `data` holds `audit-state.md` list 1 only, and
 * `organization_id` is the routing for the context a handler runs in — with no
 * foreign key, because a kernel table references no module's table (D-52).
 *
 * `sequence` is the claim order and the admin list's keyset; the partial
 * indexes serve the claim (due pending rows), lease reclaim (in-flight rows),
 * the retention purge (delivered rows) and a `--hard` uninstall (by handler
 * module).
 *
 * Registration is a regeneration: run
 * `pnpm --filter backend run composer:generate` and commit the result. An
 * unregistered migration does not run, and the round-trip guard fails the
 * build for it.
 *
 * This stamp orders this migration against its own module's migrations and
 * against nothing else. It references no table another module owns.
 */
export class Migration20261112T124348CoreCommandOutbox extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "command_outbox" (
      "id" uuid not null,
      "sequence" bigint generated always as identity,
      "action" text not null,
      "object_type" text not null,
      "object_id" text not null,
      "organization_id" uuid null,
      "hook_module" text not null,
      "hook_id" text not null,
      "data" jsonb not null default '{}',
      "actor_kind" text not null,
      "actor_admin_user_id" uuid null,
      "impersonated_customer_account_id" uuid null,
      "actor_customer_account_id" uuid null,
      "request_id" text null,
      "status" text not null default 'pending',
      "attempts" int not null default 0,
      "available_at" timestamptz not null default now(),
      "locked_until" timestamptz null,
      "last_error_code" text null,
      "last_error_class" text null,
      "created_at" timestamptz not null default now(),
      "delivered_at" timestamptz null,
      "dead_at" timestamptz null,
      constraint "command_outbox_pkey" primary key ("id"),
      constraint "command_outbox_status_check" check ("status" in ('pending', 'in_flight', 'delivered', 'dead'))
    );`);
    this.addSql(
      `create index if not exists "command_outbox_due_idx" on "command_outbox" ("available_at", "sequence") ` +
        `where "status" = 'pending';`,
    );
    this.addSql(
      `create index if not exists "command_outbox_lease_idx" on "command_outbox" ("locked_until") ` +
        `where "status" = 'in_flight';`,
    );
    this.addSql(
      `create index if not exists "command_outbox_status_seq_idx" on "command_outbox" ("status", "sequence" desc);`,
    );
    this.addSql(`create index if not exists "command_outbox_hook_module_idx" on "command_outbox" ("hook_module");`);
    this.addSql(
      `create index if not exists "command_outbox_delivered_purge_idx" on "command_outbox" ("delivered_at") ` +
        `where "status" = 'delivered';`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "command_outbox";`);
  }
}
