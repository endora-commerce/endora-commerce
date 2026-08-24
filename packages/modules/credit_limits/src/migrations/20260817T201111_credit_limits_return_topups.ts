import { Migration } from '@mikro-orm/migrations';

/**
 * `credit_limit_return_topups` — one credit per return case (D-91).
 *
 * The settlement ordering law attempts every external effect before it writes
 * any state, so a refusal from a later step leaves a retryable case and the
 * retry calls `creditFromReturn` again with the same `returnCaseId`. This table
 * is what makes the second call a no-op instead of a second credit.
 *
 * `return_case_id` is unique and carries no foreign key: `returns` depends on
 * `credit_limits`, and a constraint the other way would invert that dependency.
 */
export class Migration20260817T201111CreditLimitsReturnTopups extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "credit_limit_return_topups" (
        "id" uuid not null,
        "return_case_id" uuid not null,
        "organization_id" uuid not null,
        "amount" numeric(14,2) not null,
        "currency" varchar(3) not null,
        "applied_at" timestamptz not null,
        constraint "credit_limit_return_topups_pkey" primary key ("id"),
        constraint "credit_limit_return_topups_return_case_id_unique" unique ("return_case_id")
      );
    `);
    this.addSql(`
      create index "credit_limit_return_topups_organization_id_index"
        on "credit_limit_return_topups" ("organization_id");
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "credit_limit_return_topups";`);
  }
}
