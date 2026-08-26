import { Migration } from '@mikro-orm/migrations';

/**
 * Drops `customer_accounts.two_factor_secret`, the superseded customer 2FA
 * column.
 *
 * The column could never hold a value. `POST /api/v1/me/two-factor/enable`,
 * the only writer, assembled `<32-char base32 secret>|<10 sha256 hashes>` —
 * 682 characters — and the column is `varchar(64)`, on which PostgreSQL
 * raises `22001` rather than truncating. So the route answered 500 for every
 * customer from the day it was written, and the routes, the port and the
 * service that owned it are deleted in the same merge request. The live
 * customer 2FA surface is `mfa`'s `/api/v1/account/mfa/*`, whose own init
 * migration already records these columns as SUPERSEDED.
 *
 * **Nothing is destroyed.** Measured on the dev database on 2026-08-25:
 * `customer_accounts` holds 1 row, of which `count(two_factor_secret)` is 0.
 * `deploy/` carries `example` and `acceptance` only — there is no client
 * deployment and no production database. `down()` therefore re-creates the
 * column's shape and nothing else, because there has never been a value to
 * restore.
 *
 * `two_factor_confirmed_at` deliberately stays: it still feeds a published
 * `twoFactorEnabled` field on six API responses and two admin screens, and
 * what happens to that field is an open owner decision
 * (`specs/087-tenant-scope-enforcement/superseded-2fa-analysis.md` §7).
 */
export class Migration20260825T124759CustomerAccountsDropLegacyTwoFactorSecret extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "customer_accounts" drop column "two_factor_secret";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "customer_accounts" add column "two_factor_secret" varchar(64) null;`);
  }
}
