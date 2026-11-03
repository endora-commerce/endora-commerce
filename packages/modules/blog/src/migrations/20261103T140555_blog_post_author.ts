import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 171 (`specs/171-blog-i18n-authors/` data-model §1.4, US7) — the
 * administrator named as a post's author.
 *
 * No foreign key into `admin_users`: the blog reads administrators only through
 * `adminUserReadPort` (Principle I), and an administrator is soft-deleted, so the id
 * stays resolvable — the storefront then shows no author (OR-4). Indexed for the
 * `authorId` filter of `GET /api/v1/blog/posts`.
 */
export class Migration20261103T140555BlogPostAuthor extends Migration {
  override async up(): Promise<void> {
    this.addSql('alter table "blog_posts" add column if not exists "author_admin_user_id" uuid null;');
    this.addSql('create index if not exists "idx_blog_posts_author" on "blog_posts" ("author_admin_user_id");');
  }

  override async down(): Promise<void> {
    this.addSql('drop index if exists "idx_blog_posts_author";');
    this.addSql('alter table "blog_posts" drop column if exists "author_admin_user_id";');
  }
}
