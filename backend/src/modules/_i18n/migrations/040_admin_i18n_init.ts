import { Migration } from '@mikro-orm/migrations';

/**
 * Admin UI language versions — feature 019 / data-model.md §1.
 *
 * Schema changes (one atomic migration):
 *   - new sequence `translation_bundles_version_seq` — monotonically-
 *     increasing version vector consumed by the resolver's cache
 *     invalidation path (research §R9).
 *   - new table `translation_bundles` — one row per
 *     `(module_id, language_code)`. JSONB `entries` carries the flat
 *     translation key → string map; `version` defaults to
 *     `nextval(translation_bundles_version_seq)` so every UPSERT bumps
 *     the vector without explicit application logic.
 *   - btree index `idx_translation_bundles_language_code` to support
 *     `GET /api/v1/admin/i18n/bundles?language=…` which scans by language.
 *   - column `admin_users.preferred_language` (nullable) — NULL means
 *     "no preference saved", which the resolver treats as `'en'`
 *     (feature 019 spec FR-003 / FR-016).
 *
 * No FK on `translation_bundles.module_id`: modules are filesystem-driven
 * (feature 018) and `module_registrations` is the registry of record;
 * adding a FK here would couple lifecycle ordering in ways the existing
 * modules do not have. Cleanup is enforced by the lifecycle hard-uninstall
 * hook, not by ON DELETE CASCADE.
 */
export class Migration040AdminI18nInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create sequence "translation_bundles_version_seq" as bigint;`);

    this.addSql(`
      create table "translation_bundles" (
        "module_id" varchar(64) not null,
        "language_code" varchar(12) not null,
        "entries" jsonb not null default '{}'::jsonb,
        "version" bigint not null default nextval('translation_bundles_version_seq'),
        "installed_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "translation_bundles_pkey" primary key ("module_id", "language_code")
      );
    `);

    this.addSql(
      `alter sequence "translation_bundles_version_seq" owned by "translation_bundles"."version";`,
    );

    this.addSql(
      `create index "idx_translation_bundles_language_code" on "translation_bundles" ("language_code");`,
    );

    this.addSql(
      `alter table "admin_users" add column "preferred_language" varchar(12) null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "admin_users" drop column if exists "preferred_language";`);
    this.addSql(`drop table if exists "translation_bundles";`);
    this.addSql(`drop sequence if exists "translation_bundles_version_seq";`);
  }
}
