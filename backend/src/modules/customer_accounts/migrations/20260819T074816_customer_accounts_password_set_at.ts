import { Migration } from '@mikro-orm/migrations';

/**
 * Issue #222 — `customer_accounts.password_set_at`.
 *
 * `password_hash` is NOT NULL for every account, including the ones federated
 * sign-in auto-creates with a random pair of UUIDs nobody is told, so it cannot
 * answer "does the holder have a password they can use". This column can.
 *
 * **Backfilled `null` for every existing row, with no conditional logic.** The
 * alternative considered was `created_at` for everyone except accounts holding
 * a social link — but there are no socially-created accounts anywhere, so that
 * exception has an empty extension and what would actually ship is `created_at`
 * for *every* row: the claim that every existing holder personally chose their
 * password, which is untrue for any account an admin, an import or any other
 * on-their-behalf path created. `null` says what is true — we do not know — and
 * becomes accurate for every account from the first write onwards.
 */
export class Migration20260819T074816CustomerAccountsPasswordSetAt extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "customer_accounts" add column "password_set_at" timestamptz null;');
  }

  override async down(): Promise<void> {
    this.addSql('alter table "customer_accounts" drop column "password_set_at";');
  }
}
