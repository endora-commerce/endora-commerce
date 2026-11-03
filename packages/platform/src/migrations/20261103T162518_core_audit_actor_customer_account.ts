import { Migration } from '@mikro-orm/migrations';

/**
 * The customer who acted, on the audit row (`specs/170-organization-roles/`
 * migration M1; research R-21, data-model §4; FR-065, SC-006).
 *
 * Adds a nullable `actor_customer_account_id uuid` to `audit_log_entries`. A
 * Command a customer issues for themselves — a storefront administrator
 * changing a role, a member's own write — used to record `actor_admin_user_id
 * = null` and nothing else, so the entry read as nobody's. The bus fills the
 * column from the ambient tenant context; it stays `null` for operator, system
 * and API-key entries, and under impersonation, which keeps its two existing
 * columns (`actor_admin_user_id` + `impersonated_customer_account_id`).
 *
 * No backfill: an entry written before this column cannot be attributed after
 * the fact, and `null` is what it already meant. No foreign key, for the reason
 * the two existing actor columns carry none — an audit row outlives the account
 * it names. `if not exists` / `if exists` keep a re-run harmless (FR-074);
 * `down` drops the column and every attribution in it.
 *
 * Registration is a regeneration: run
 * `pnpm --filter backend run composer:generate` and commit the result. An
 * unregistered migration does not run, and the round-trip guard fails the
 * build for it.
 *
 * This stamp orders this migration against its own module's migrations and
 * against nothing else. It references no table another module owns.
 */
export class Migration20261103T162518CoreAuditActorCustomerAccount extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "audit_log_entries" add column if not exists "actor_customer_account_id" uuid null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "audit_log_entries" drop column if exists "actor_customer_account_id";`);
  }
}
