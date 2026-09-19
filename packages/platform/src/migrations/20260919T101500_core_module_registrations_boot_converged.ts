import { Migration } from '@mikro-orm/migrations';

/**
 * `module_registrations.boot_converged_at` — the marker that says a row was
 * written by boot convergence and no install has run.
 *
 * ## What it closes
 *
 * `reconcileExistingModules` inserts `state='installed'` for every shipped
 * manifest with no row, from `composeApp`, and runs no install hook. `install`
 * then short-circuited on `state === 'installed'` and answered
 * `already-installed`, so a database whose first action after the migrations was
 * a boot could never run any `installHook`, and nothing said so. This column is
 * the one datum that tells the two kinds of `installed` row apart.
 *
 * ## Purely additive, and the absence of a backfill is provable
 *
 * The column is nullable and every existing row keeps `null`, which reads as
 * *"an install produced this"*. That is correct for all of them: until feature
 * 134's W7 the tree had **no `installHook` at all** — `custom_fields`'
 * `uninstallHook` was the only lifecycle hook in it — so no historical
 * `installed` row can have skipped one. A blanket backfill would assert the
 * opposite of the truth for every row a real `module:install` wrote.
 *
 * The four-state FSM is untouched: this says nothing about `state` and adds no
 * constraint to it. Filed under `core` like every other migration in this
 * package — the kernel owns the table, and a hard uninstall reverts by registry
 * `moduleId`, so filing it under a module would make that module's
 * `--hard` uninstall drop kernel schema.
 */
export class Migration20260919T101500CoreModuleRegistrationsBootConverged extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "module_registrations" add column "boot_converged_at" timestamptz null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "module_registrations" drop column "boot_converged_at";`);
  }
}
