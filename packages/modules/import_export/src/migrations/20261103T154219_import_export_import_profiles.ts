import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 172 (`specs/172-product-editor-scope-switcher/data-model.md` §11, research R14) — the
 * import profiles of `import_export`: a named, platform-global locale mapping a products import
 * is run with.
 *
 * - `name` is unique case-insensitively, by a raw `lower(name)` index (no `@Unique` in the entity).
 * - `entity` is `'products'` — the only entity with a mapping in 172 (CHECK).
 * - `locale_mapping` holds `pimLocaleMappingEntriesSchema`'s entries. Their target channel ids carry
 *   **no** foreign key: a deleted channel makes a target invalid, reported per row at import
 *   (FR-042), and the profile itself stays.
 *
 * No other module's table is named, so the manifest needs no new dependency.
 */
export class Migration20261103T154219ImportExportImportProfiles extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "import_profiles" (
        "id" uuid not null,
        "name" varchar(120) not null,
        "entity" varchar(32) not null,
        "source_language_for_global" varchar(16) null,
        "locale_mapping" jsonb not null default '[]'::jsonb,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "import_profiles_pkey" primary key ("id"),
        constraint "import_profiles_entity_check" check ("entity" in ('products'))
      );
    `);
    this.addSql(`create unique index "import_profiles_name_lower_unique" on "import_profiles" (lower("name"));`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "import_profiles";`);
  }
}
