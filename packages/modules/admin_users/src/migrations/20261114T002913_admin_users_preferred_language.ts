import { Migration } from '@mikro-orm/migrations';

/**
 * `admin_users.preferred_language` — an administrator's saved admin UI
 * language (feature 019; NULL means no preference, which the resolver reads as
 * `'en'`), created by the module whose `AdminUser.preferredLanguage` maps it.
 *
 * Until issue #611 the only migration creating it was `_i18n`'s frozen
 * `Migration20260507T091405I18nAdminI18nInit`, so another module's migration
 * decided this module's schema — the write the migration table-ownership rule
 * (feature 097, R2) refuses, whether or not `_i18n` declares this module, which
 * it does. The frozen init keeps its class name and lost only this statement
 * and its inverse, the shape D-226 gave the `cms_pages` index `assets_library`'s
 * frozen init carried (`Migration20260912T125709CmsPageBodyAssetRefIndex`).
 *
 * **`if not exists`**, because every database that ran the frozen init already
 * has the column, and there this must be a no-op that keeps every value. The
 * type and nullability are the frozen statement verbatim, so the two paths
 * reach one schema. `down()` drops the column, as the frozen init's did: this
 * module creates `admin_users` itself, so the table does not outlive it.
 */
export class Migration20261114T002913AdminUsersPreferredLanguage extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "admin_users" add column if not exists "preferred_language" varchar(12) null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "admin_users" drop column if exists "preferred_language";`);
  }
}
