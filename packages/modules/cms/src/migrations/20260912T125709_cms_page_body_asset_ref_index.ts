import { Migration } from '@mikro-orm/migrations';

/**
 * The GIN index on `cms_pages.body` that keeps the assets-library
 * reference-protection scan fast (feature 013, research R10 — the reference
 * registry's CMS descriptor runs `jsonb_path_exists` over `body`).
 *
 * It was created by `assets_library`' frozen
 * `Migration20260505T102206AssetsLibraryInit` until
 * `specs/120-migration-closure-bridge-ownership/` Phase 3. Under D-226 a
 * migration may name a table only if its own module, its transitive
 * `dependencies` closure or the platform creates it, and `assets_library`
 * does not declare `cms` — nor could it sensibly, `cms` declaring
 * `assets_library`. An instance that omits `cms` had `assets_library`'s init
 * indexing a table nothing builds.
 *
 * It belongs here because `cms_pages` is this module's own table, and the
 * closure holds in the direction the SQL runs: this module declares
 * `assets_library`, not the other way round. The index exists for a
 * consumer in another module and lives with the table it is on, which is
 * what the ownership rule says.
 *
 * `if not exists`, because every database that has already applied the
 * frozen migration has this index. The storage keys on the class name and
 * holds no checksum, so the reduced frozen body is not re-offered there.
 * The statement is otherwise the frozen one verbatim — same name, same
 * operator class — so the two paths reach one schema.
 */
export class Migration20260912T125709CmsPageBodyAssetRefIndex extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      'create index if not exists "idx_cms_pages_body_asset_refs" on "cms_pages" using gin ("body" jsonb_path_ops);',
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop index if exists "idx_cms_pages_body_asset_refs";');
  }
}
