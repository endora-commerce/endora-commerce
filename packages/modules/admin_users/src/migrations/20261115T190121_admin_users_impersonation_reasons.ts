import { Migration } from '@mikro-orm/migrations';

/**
 * Issue #470 (D-288) — `admin_impersonation_reasons`, the reason an
 * administrator gave when they started impersonating a customer account. The
 * reason is free text about a tenant's account, so it left the platform audit
 * log; the `impersonation.start` entry carries this row's id as
 * `valueChangeId` (`specs/conventions/audit-state.md` §3).
 *
 * One row per start that carried a reason, written in the start's audit
 * transaction and never updated. `organization_id` is the account's
 * Organization at the start, not null because an account always has one
 * (D-178).
 *
 * No foreign key: `customer_account_id` is `customer_accounts`' table, which
 * this module does not declare, and `actor_admin_user_id` is kept as an opaque
 * id, as the audit entry it belongs to keeps it, so a reason outlives the
 * administrator's hard delete like the entry does.
 */
export class Migration20261115T190121AdminUsersImpersonationReasons extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "admin_impersonation_reasons" (
        "id" uuid not null,
        "customer_account_id" uuid not null,
        "organization_id" uuid not null,
        "actor_admin_user_id" uuid not null,
        "reason" text not null,
        "at" timestamptz not null default now(),
        constraint "admin_impersonation_reasons_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `create index "admin_impersonation_reasons_customer_account_idx" on "admin_impersonation_reasons" ("customer_account_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "admin_impersonation_reasons";`);
  }
}
