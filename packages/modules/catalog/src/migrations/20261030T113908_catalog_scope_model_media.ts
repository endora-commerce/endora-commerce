import { Migration } from '@mikro-orm/migrations';

/**
 * TODO describe the change this migration makes.
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
export class Migration20261030T113908CatalogScopeModelMedia extends Migration {
  override async up(): Promise<void> {
    // this.addSql(`…`);
  }

  override async down(): Promise<void> {
    // this.addSql(`…`);
  }
}
