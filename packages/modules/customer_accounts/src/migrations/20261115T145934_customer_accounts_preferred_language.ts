import { Migration } from '@mikro-orm/migrations';

/**
 * Issue #652 — the language a customer account's owner reads: one BCP-47
 * content-language tag, spelled the way the sales channel that captured it
 * spells it (`pl-PL`, `en-US`).
 *
 * Nullable and not backfilled. `NULL` means "not known yet", which is the
 * honest answer for every account that exists today: a pre-existing account
 * gets its value at its next sign-in, and a reader of `NULL` falls back to the
 * rendering channel's default language — what every account had before this
 * column. `varchar(35)` is RFC 5646 §4.4.1's recommended minimum buffer for a
 * language tag.
 *
 * Personal data (D-288 list 2): the anonymisation sweep sets it back to `NULL`
 * and it never appears in an audit state. The table is this module's own, so
 * nothing is declared.
 */
export class Migration20261115T145934CustomerAccountsPreferredLanguage extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'alter table "customer_accounts" add column if not exists "preferred_language" varchar(35) null;',
    );
  }

  override async down(): Promise<void> {
    this.addSql('alter table "customer_accounts" drop column if exists "preferred_language";');
  }
}
