import { Migration } from '@mikro-orm/migrations';

/**
 * shopping_lists module — Phase 5 (T200).
 *
 * Schema:
 *   - shopping_lists: scoped by (organization_id, customer_account_id) for
 *     owner queries. No FK constraint on customer_account_id /
 *     organization_id since those tables already exist; we keep the same
 *     "plain uuid columns" pattern the rest of the codebase uses.
 *   - shopping_list_items: cascade delete on the parent list, plain uuid
 *     FK to products so product archival doesn't drop list rows (the
 *     conversion service surfaces archived rows in a skip report).
 */
export class Migration20260426T135443ShoppingListsInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "shopping_lists" (
        "id" uuid not null,
        "organization_id" uuid not null,
        "customer_account_id" uuid not null,
        "name" varchar(160) not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "shopping_lists_pkey" primary key ("id")
      );
    `);
    this.addSql(
      'create index "shopping_lists_organization_id_index" on "shopping_lists" ("organization_id");',
    );
    this.addSql(
      'create index "shopping_lists_customer_account_id_index" on "shopping_lists" ("customer_account_id");',
    );

    this.addSql(`
      create table "shopping_list_items" (
        "id" uuid not null,
        "shopping_list_id" uuid not null,
        "product_id" uuid not null,
        "variant_id" uuid null,
        "quantity" int not null,
        "note" text null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "shopping_list_items_pkey" primary key ("id")
      );
    `);
    this.addSql(
      'create index "shopping_list_items_shopping_list_id_index" on "shopping_list_items" ("shopping_list_id");',
    );
    this.addSql(
      'create index "shopping_list_items_product_id_index" on "shopping_list_items" ("product_id");',
    );
    this.addSql(
      `alter table "shopping_list_items" add constraint "shopping_list_items_list_fk"
        foreign key ("shopping_list_id") references "shopping_lists" ("id") on delete cascade;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "shopping_list_items" cascade;');
    this.addSql('drop table if exists "shopping_lists" cascade;');
  }
}
