import { Migration } from '@mikro-orm/migrations';

/**
 * CMS pages init (T234 / FR-100). One table; `path` is the natural unique
 * key. Status enum drives the admin lifecycle.
 */
export class Migration013CmsPagesInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "cms_pages" (
        "id" uuid not null,
        "path" varchar(180) not null,
        "status" varchar(16) not null default 'draft',
        "title" jsonb not null default '{}'::jsonb,
        "body" jsonb not null default '{}'::jsonb,
        "published_at" timestamptz null,
        "archived_at" timestamptz null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "cms_pages_pkey" primary key ("id"),
        constraint "cms_pages_path_unique" unique ("path")
      );
    `);
    this.addSql('create index "cms_pages_path_index" on "cms_pages" ("path");');
    this.addSql('create index "cms_pages_status_index" on "cms_pages" ("status");');
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "cms_pages" cascade;');
  }
}
