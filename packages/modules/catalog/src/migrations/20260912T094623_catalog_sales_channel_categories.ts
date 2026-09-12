import { Migration } from '@mikro-orm/migrations';

/**
 * The `sales_channel_categories` sales-channel bridge — the categories a channel exposes.
 *
 * It was created by the platform's frozen `Migration20260430T170044CoreSalesChannelsPromote`
 * until `specs/120-migration-closure-bridge-ownership/` Phase 2. Under D-226 a
 * bridge between an always-present near side (`sales_channels`, a kernel table)
 * and a switchable far side belongs to the far side, so this module creates it:
 * an instance that does not install `catalog` no longer has a migration corpus
 * naming a table nothing builds.
 *
 * `if not exists`, because every database that has already applied the frozen
 * migration has this table. The storage keys on the class name and holds no
 * checksum, so nothing is re-offered there and this migration is the no-op it
 * reads as; on a fresh database it is the creation.
 *
 * The statements are the frozen ones verbatim — same columns, same primary key,
 * same two foreign keys, same index — so the two paths reach one schema. Its
 * position needs nothing declared: `sales_channels` is the kernel's and
 * `categories` is created inside the frozen prefix, which every
 * above-watermark migration runs after.
 */
export class Migration20260912T094623CatalogSalesChannelCategories extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table if not exists "sales_channel_categories" (
        "sales_channel_id" uuid not null,
        "category_id" uuid not null,
        constraint "sales_channel_categories_pkey"
          primary key ("sales_channel_id", "category_id"),
        constraint "sales_channel_categories_channel_fk"
          foreign key ("sales_channel_id") references "sales_channels" ("id") on delete cascade,
        constraint "sales_channel_categories_category_fk"
          foreign key ("category_id") references "categories" ("id") on delete cascade
      );
    `);
    this.addSql(
      'create index if not exists "sales_channel_categories_category_id_index" ' +
        'on "sales_channel_categories" ("category_id");',
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "sales_channel_categories" cascade;');
  }
}
