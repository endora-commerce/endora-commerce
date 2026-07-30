import { Migration } from '@mikro-orm/migrations';

/**
 * Prompt Actions module init (feature 043).
 *
 * Creates `prompt_action_requests` — one row per operator-submitted
 * natural-language instruction, carrying the full lifecycle: interpretation
 * output (plan / clarification), confirmation, execution result, and the
 * `seen_at` marker that drives the "finished while you were away" notice.
 *
 * No FK on `admin_user_id` (matches the `module_actions` precedent: admin
 * users are platform-owned; the lifecycle orchestrator owns cleanup).
 */
export class Migration20260611T140410PromptActionsInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "prompt_action_requests" (
        "id" uuid not null,
        "admin_user_id" uuid not null,
        "prompt" text not null,
        "language" varchar(12) null,
        "status" varchar(32) not null,
        "provider" varchar(32) null,
        "model" varchar(120) null,
        "plan" jsonb null,
        "clarification" jsonb null,
        "conversation" jsonb null,
        "result" jsonb null,
        "error" text null,
        "bulk_operation_id" uuid null,
        "seen_at" timestamptz null,
        "confirmed_at" timestamptz null,
        "finished_at" timestamptz null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "prompt_action_requests_pkey" primary key ("id")
      );
    `);
    this.addSql(`
      create index "prompt_action_requests_admin_user_id_created_at_index"
        on "prompt_action_requests" ("admin_user_id", "created_at" desc);
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "prompt_action_requests" cascade;`);
  }
}
