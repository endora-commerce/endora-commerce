import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import type { RegistryState } from '@b2b/contracts';

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
@Entity({ tableName: 'module_registrations' })
export class ModuleRegistration {
  [OptionalProps]?:
    | 'lastInstallFailedAt'
    | 'lastInstallError'
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

  @Property({ type: 'Date' })
  createdAt: Date = new Date();

  @Property({ type: 'Date', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
