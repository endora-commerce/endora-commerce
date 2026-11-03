import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 171 (`specs/171-blog-i18n-authors/` data-model §2.1, US6) — an
 * administrator's public author profile: an avatar (a library asset id, the same in
 * every language) and a biography per language.
 *
 * `avatar_asset_id` carries no foreign key: `assets_library` depends on this module,
 * so a reference into its table would invert that edge. The library counts the
 * avatar as a use of the asset through `adminUserReadPort.findByAvatarAssetIds`
 * instead (research R9). Both columns are nullable, so every existing row reads as
 * "no profile yet".
 */
export class Migration20261103T140300AdminUsersAuthorProfile extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "admin_users"
        add column if not exists "avatar_asset_id" uuid null,
        add column if not exists "bio" jsonb null;
    `);
    this.addSql('create index if not exists "idx_admin_users_avatar_asset" on "admin_users" ("avatar_asset_id");');
  }

  override async down(): Promise<void> {
    this.addSql('drop index if exists "idx_admin_users_avatar_asset";');
    this.addSql(`
      alter table "admin_users"
        drop column if exists "bio",
        drop column if exists "avatar_asset_id";
    `);
  }
}
