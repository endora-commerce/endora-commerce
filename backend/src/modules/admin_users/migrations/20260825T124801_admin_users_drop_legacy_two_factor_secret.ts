import { Migration } from '@mikro-orm/migrations';

/**
 * Drops `admin_users.two_factor_secret`, the superseded admin 2FA column.
 *
 * This half is further gone than the customer one: the column has **no writer
 * anywhere in the tree** — an entity declaration and the init DDL, and nothing
 * else. Admin 2FA is `mfa`'s, over `mfa_enrolments`, with an encrypted secret
 * and single-use recovery-code rows; `mfa`'s own init migration records this
 * column as SUPERSEDED.
 *
 * **Nothing is destroyed.** Measured on the dev database on 2026-08-25:
 * `admin_users` holds 3 rows, of which `count(two_factor_secret)` is 0. There
 * is no client deployment and no production database. `down()` re-creates the
 * column's shape and nothing else, because there has never been a value to
 * restore.
 *
 * `two_factor_confirmed_at` deliberately stays — see the sibling migration in
 * `customer_accounts` and
 * `specs/087-tenant-scope-enforcement/superseded-2fa-analysis.md` §7.
 */
export class Migration20260825T124801AdminUsersDropLegacyTwoFactorSecret extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "admin_users" drop column "two_factor_secret";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "admin_users" add column "two_factor_secret" varchar(64) null;`);
  }
}
