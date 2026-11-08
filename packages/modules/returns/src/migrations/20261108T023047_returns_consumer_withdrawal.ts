import { Migration } from '@mikro-orm/migrations';

/**
 * Issue #905 — the consumer-withdrawal schema, in one migration so the later
 * changes of the same plan add none (design §4.1, §4.2).
 *
 * On `return_cases`:
 * - `consumer_withdrawal`: whether the case is a consumer's withdrawal from a
 *   distance contract, fixed when it is filed. `null` = filed before this
 *   column existed. Not backfilled here: the answer needs the Organization's
 *   `is_personal`, which is the `organizations` module's table, and a migration
 *   reads no other module's table (`specs/conventions/module-migrations.md`
 *   item 4a). Such a case reads as `false`.
 * - `withdrawal_received_at`, `reimbursement_due_at`, `goods_received_at`,
 *   `return_proof_at`, `reimbursement_notified_state`: the facts of the 14-day
 *   reimbursement deadline (design D2).
 * - `alternative_consent_*`: the consumer's consent to a credit, a replacement
 *   or a repair instead of a refund, with the evidence and the operator who
 *   recorded it (design D1).
 *
 * `return_withdrawal_statements`: the consumer's withdrawal statement as
 * submitted through the withdrawal function, one per case, immutable but for
 * its acknowledgement columns (Directive 2011/83 art. 11a, design §4.1).
 * `consumer_name` and `confirmation_email` are the only personal data on it and
 * are nullable: the statement is kept after the customer is anonymised, without
 * them (owner ruling on #905, 2026-11-07).
 *
 * Every column is nullable or defaulted, every statement idempotent, and only
 * this module's own tables are touched.
 */
export class Migration20261108T023047ReturnsConsumerWithdrawal extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "return_cases"
        add column if not exists "consumer_withdrawal" boolean null,
        add column if not exists "withdrawal_received_at" timestamptz null,
        add column if not exists "reimbursement_due_at" timestamptz null,
        add column if not exists "goods_received_at" timestamptz null,
        add column if not exists "return_proof_at" timestamptz null,
        add column if not exists "reimbursement_notified_state" varchar(16) null,
        add column if not exists "alternative_consent_resolution" varchar(16) null,
        add column if not exists "alternative_consent_at" timestamptz null,
        add column if not exists "alternative_consent_note" text null,
        add column if not exists "alternative_consent_by_admin_user_id" uuid null,
        add column if not exists "alternative_consent_source" varchar(32) null;
    `);
    this.addSql(`
      create index if not exists "return_cases_consumer_withdrawal_due_idx"
        on "return_cases" ("consumer_withdrawal", "reimbursement_due_at")
        where "consumer_withdrawal";
    `);

    this.addSql(`
      create table if not exists "return_withdrawal_statements" (
        "id" uuid not null,
        "return_case_id" uuid not null,
        "order_id" uuid not null,
        "organization_id" uuid not null,
        "customer_account_id" uuid null,
        "channel" varchar(32) not null,
        "submission_id" uuid not null,
        "submitted_at" timestamptz not null,
        "consumer_name" text null,
        "confirmation_email" varchar(320) null,
        "order_number" varchar(128) not null,
        "scope" varchar(16) not null,
        "lines" jsonb not null,
        "within_statutory_period" boolean not null,
        "period_ends_at" timestamptz null,
        "acknowledgement_sent_at" timestamptz null,
        "acknowledgement_attempts" int not null default 0,
        "created_at" timestamptz not null,
        constraint "return_withdrawal_statements_pkey" primary key ("id"),
        constraint "return_withdrawal_statements_return_case_id_unique" unique ("return_case_id"),
        constraint "return_withdrawal_statements_submission_id_unique" unique ("submission_id"),
        constraint "return_withdrawal_statements_return_case_id_foreign"
          foreign key ("return_case_id") references "return_cases" ("id") on update cascade on delete cascade
      );
    `);
    this.addSql(
      `create index if not exists "return_withdrawal_statements_order_idx" on "return_withdrawal_statements" ("order_id");`,
    );
    this.addSql(
      `create index if not exists "return_withdrawal_statements_organization_idx" on "return_withdrawal_statements" ("organization_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "return_withdrawal_statements";`);
    this.addSql(`drop index if exists "return_cases_consumer_withdrawal_due_idx";`);
    this.addSql(`
      alter table "return_cases"
        drop column if exists "alternative_consent_source",
        drop column if exists "alternative_consent_by_admin_user_id",
        drop column if exists "alternative_consent_note",
        drop column if exists "alternative_consent_at",
        drop column if exists "alternative_consent_resolution",
        drop column if exists "reimbursement_notified_state",
        drop column if exists "return_proof_at",
        drop column if exists "goods_received_at",
        drop column if exists "reimbursement_due_at",
        drop column if exists "withdrawal_received_at",
        drop column if exists "consumer_withdrawal";
    `);
  }
}
