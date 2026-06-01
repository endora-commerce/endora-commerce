import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 038 — order comments (US5) and admin orders-list saved views (US2).
 */
export class Migration055OrderCommentsAndSavedViews extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "order_comments" (
        "id" uuid not null,
        "order_id" uuid not null,
        "author_admin_user_id" uuid null,
        "author_customer_account_id" uuid null,
        "body" text not null,
        "is_customer_visible" boolean not null default true,
        "notify_customer" boolean not null default false,
        "created_at" timestamptz not null,
        constraint "order_comments_pkey" primary key ("id")
      );
    `);
    this.addSql(`create index "order_comments_order_id_idx" on "order_comments" ("order_id");`);
    this.addSql(`create index "order_comments_created_at_idx" on "order_comments" ("created_at");`);

    this.addSql(`
      create table "order_list_saved_views" (
        "id" uuid not null,
        "owner_admin_user_id" uuid not null,
        "name" varchar(160) not null,
        "shared" boolean not null default false,
        "filters" jsonb not null,
        "sort" jsonb not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "order_list_saved_views_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `create index "order_list_saved_views_owner_idx" on "order_list_saved_views" ("owner_admin_user_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "order_list_saved_views";`);
    this.addSql(`drop table if exists "order_comments";`);
  }
}
