import { Migration } from '@mikro-orm/migrations';

/**
 * Category page content — the Page Builder document an operator authors for a
 * category's storefront page, one per language:
 * `{ "languages": { "<code>": <document> } }`, the envelope a CMS page and a
 * blog category description use.
 *
 * Nullable with no default: `null` is "no content authored", which is every
 * category that exists when this runs, and the storefront renders nothing for
 * it. `jsonb` rather than `json` so a later reference lookup (which library
 * asset does a document embed) can use `jsonb_path_exists`, as the CMS and blog
 * columns do.
 *
 * No index: the column is read by primary key only — one category's page, one
 * category's editor.
 */
export class Migration20261008T092714CatalogCategoryContent extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "categories" add column "content" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "categories" drop column "content";`);
  }
}
