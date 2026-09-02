import { Migration } from '@mikro-orm/migrations';

/**
 * Module-Contributed Admin Actions — feature 020 / data-model.md.
 *
 * Schema changes (one atomic migration):
 *   - new sequence `module_actions_version_seq` — monotonically-
 *     increasing version vector consumed by the registry's HTTP cache
 *     for `meta.registryVersion` diagnostics.
 *   - new table `module_actions` — one row per `(module_id, action_id)`.
 *     Stores the action's i18n keys, icon, target route, optional
 *     required-permission code, optional keywords array (JSONB), and
 *     ordering weight. Reconciler at module-install time UPSERTs every
 *     declared action and prunes any rows the new manifest no longer
 *     declares.
 *   - btree index `idx_module_actions_weight_label_key` to support the
 *     visibility query's ORDER BY (weight, label_key) when the cache
 *     misses.
 *
 * No FK on `module_actions.module_id`: same rationale as feature 019's
 * `translation_bundles` — modules are filesystem-driven (feature 018)
 * and `module_registrations` is the registry of record; coupling
 * lifecycle ordering through a FK would conflict with how the
 * orchestrator runs its install phases. Cleanup is enforced by the
 * lifecycle hard-uninstall hook (admin-actions reconciler), not by
 * ON DELETE CASCADE.
 */
export class Migration20260507T142354AdminActionsInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create sequence "module_actions_version_seq" as bigint;`);

    this.addSql(`
      create table "module_actions" (
        "module_id" varchar(64) not null,
        "action_id" varchar(64) not null,
        "label_key" varchar(255) not null,
        "description_key" varchar(255) null,
        "icon" varchar(64) not null,
        "target_route" varchar(255) not null,
        "required_permission" varchar(64) null,
        "keywords" jsonb not null default '[]'::jsonb,
        "weight" integer not null default 100,
        "version" bigint not null default nextval('module_actions_version_seq'),
        "installed_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "module_actions_pkey" primary key ("module_id", "action_id")
      );
    `);

    this.addSql(
      `alter sequence "module_actions_version_seq" owned by "module_actions"."version";`,
    );

    this.addSql(
      `create index "idx_module_actions_weight_label_key" on "module_actions" ("weight", "label_key");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "module_actions";`);
    this.addSql(`drop sequence if exists "module_actions_version_seq";`);
  }
}
