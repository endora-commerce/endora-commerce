import { Migration } from '@mikro-orm/migrations';

/**
 * Module Lifecycle subsystem — feature 018 / data-model.md.
 *
 * Schema changes (one atomic migration):
 *   - new table `module_registrations` — persisted runtime state of every
 *     module the system has ever installed. PK is the module id (matches
 *     manifest `id`); state CHECK enforces the four-state FSM
 *     (installing / installed / disabled / uninstalled).
 *   - btree index `idx_module_registrations_state` to support
 *     `module:status --filter=<state>` (low cardinality but cheap).
 *
 * No seed rows. Existing modules are recorded in this table only after
 * their first `module:install <id>` run (which is what the retrofit pass
 * upgrades the existing settings-only manifests into).
 */
export class Migration039ModuleLifecycleInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "module_registrations" (
        "module_id" varchar(80) not null,
        "state" varchar(16) not null,
        "version" varchar(32) not null,
        "installed_at" timestamptz not null,
        "last_state_change_at" timestamptz not null,
        "last_install_failed_at" timestamptz null,
        "last_install_error" text null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "module_registrations_pkey" primary key ("module_id"),
        constraint "module_registrations_state_check" check ("state" in
          ('installing', 'installed', 'disabled', 'uninstalled'))
      );
    `);
    this.addSql(
      `create index "idx_module_registrations_state" on "module_registrations" ("state");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "module_registrations";`);
  }
}
