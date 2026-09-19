import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../tenancy/org-scoped.decorator.js';
import type { RegistryState } from '@endora-commerce/contracts';

/**
 * Module Registration — feature 018 / data-model.md.
 *
 * One row per module the system has ever installed. The PK is the module
 * id (matches `manifest.id`). State follows the four-state FSM enforced
 * by a CHECK constraint on the column. Hard-uninstall deletes the row;
 * soft-uninstall leaves it in `state = 'uninstalled'` so a later
 * re-install can detect the prior version and skip already-applied
 * migrations.
 */
@GlobalEntity()
@Entity({ tableName: 'module_registrations' })
export class ModuleRegistration {
  [OptionalProps]?:
    | 'lastInstallFailedAt'
    | 'lastInstallError'
    | 'bootConvergedAt'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'string', length: 80 })
  moduleId!: string;

  @Property({ type: 'string', length: 16 })
  state!: RegistryState;

  @Property({ type: 'string', length: 32 })
  version!: string;

  @Property({ type: 'Date' })
  installedAt!: Date;

  @Property({ type: 'Date' })
  lastStateChangeAt!: Date;

  @Property({ type: 'Date', nullable: true })
  lastInstallFailedAt?: Date | null = null;

  @Property({ type: 'text', nullable: true })
  lastInstallError?: string | null = null;

  /**
   * *"This row was written by boot convergence, and no install has run."*
   *
   * `reconcileExistingModules` inserts `state='installed'` for every shipped
   * manifest with no row, from `composeApp`, and runs no install hook — it
   * cannot, and D-157.6(b) is why it must not. Before this column,
   * `install` could not tell such a row from one it had written itself, so it
   * answered `already-installed` and the module's `installHook` never ran and
   * never would: no migration, no settings reconcile, no participant pass, and
   * nothing said so. The marker is the one datum that distinguishes the two,
   * and it is what makes `module:install --all` the command that **repairs** a
   * boot-first database.
   *
   * Written only by the reconciler and cleared only by `install`'s step 4. Any
   * other writer would be claiming an install did not happen when it did, which
   * is the opposite of what this field says.
   *
   * **No backfill, and it is provable rather than chosen.** The migration adds
   * the column `null` everywhere. No `installed` row predating it can have
   * skipped a hook, because until feature 134's W7 the tree had **no
   * `installHook` at all** — `custom_fields`' `uninstallHook` was the only
   * lifecycle hook in it. A blanket backfill would make every existing row claim
   * *"no install has run"* when one had, which would stop the field meaning what
   * it says and would be the wrong datum for a future boot refusal to read.
   *
   * **One residual it does not reach**, recorded rather than discovered: a
   * database converged *before* this column existed holds `null`, so a module
   * that gains its first `installHook` afterwards is still answered
   * `already-installed` there. `db:fresh` plus the `setup` script is the dev
   * remedy, and `module:uninstall <id> && module:install <id>` the surgical one.
   */
  @Property({ type: 'Date', nullable: true })
  bootConvergedAt?: Date | null = null;

  @Property({ type: 'Date' })
  createdAt: Date = new Date();

  @Property({ type: 'Date', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
