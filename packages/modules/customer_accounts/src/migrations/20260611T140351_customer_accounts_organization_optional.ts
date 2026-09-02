import { Migration } from '@mikro-orm/migrations';

/**
 * Relaxes `customer_accounts.organization_id` from NOT NULL to nullable
 * (feature 026 US2 — Customer accounts may exist without an Organization).
 *
 * **This migration's design is dead, and everything below it describes a
 * platform that no longer exists.** Feature 051 replaced it — an individual is
 * backed by a single-member personal Organization — and D-178 re-tightened the
 * column in
 * `20260825T141659_customer_accounts_organization_required`. The paragraphs
 * below are kept because they say what this statement did on the day it ran;
 * read them as history and not as current behaviour. In particular the `down()`
 * here is not a working re-tightening recipe: it sets `organization_id` to the
 * account's own id against a live `customer_accounts_organization_fk`, so it
 * fails rather than corrupting. Do not copy it.
 *
 * Existing rows are unaffected (they keep their organization_id). The
 * column's foreign-key constraint stays in place — when the column IS
 * populated, it still references organizations(id) ON DELETE RESTRICT.
 *
 * Application-side implications (handled in code, not in this migration):
 *  - The Customer's effective Organization (for prices, credit limit,
 *    payment / delivery / warehouse allow-lists) becomes null → falls
 *    back to platform defaults.
 *  - Order placement and Quote Request submission still REQUIRE an
 *    Organization — the route handlers surface a friendly 422 when the
 *    caller has no Organization. Orders and RFQs remain NOT NULL at the
 *    schema level.
 */
export class Migration20260611T140351CustomerAccountsOrganizationOptional extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "customer_accounts" alter column "organization_id" drop not null;`);
  }

  override async down(): Promise<void> {
    // Safe re-tightening: only re-add NOT NULL if every existing row has a
    // value. (Production should NEVER hit this path while feature 026 is in
    // use — but the down() must be valid even if it cannot succeed against
    // partially-migrated data.)
    this.addSql(
      `update "customer_accounts" set "organization_id" = "id" where "organization_id" is null;`,
    );
    this.addSql(`alter table "customer_accounts" alter column "organization_id" set not null;`);
  }
}
