import { Migration } from '@mikro-orm/migrations';

/**
 * A bell entry may carry a translatable message beside its finished sentence.
 *
 * `title` and `body` were, and stay, the sentence as its writer composed it —
 * in English. One entry is read by many administrators, each in a language of
 * their own, so the writer cannot translate it; these two columns hold what
 * the Admin UI needs to do so when it draws the entry:
 * `{ "scope": <bundle namespace>, "key": <key in that bundle>, "params": {…} }`.
 *
 * Both are nullable with no default and nothing is backfilled: a row written
 * before this migration, or by a caller that gives no message, reads `null`
 * and is shown its `title` exactly as before.
 *
 * Registration is a regeneration: run
 * `pnpm --filter backend run composer:generate` and commit the result. An
 * unregistered migration does not run, and the round-trip guard fails the
 * build for it.
 *
 * This stamp orders this migration against its own module's migrations and
 * against nothing else. What puts it after another module's table is that
 * module appearing in this one's manifest `dependencies` — declare it if
 * this migration references a table it owns.
 */
export class Migration20261007T194748AdminNotificationsMessageKeys extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "admin_notifications"
        add column "title_message" jsonb null,
        add column "body_message" jsonb null;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`
      alter table "admin_notifications"
        drop column if exists "title_message",
        drop column if exists "body_message";
    `);
  }
}
