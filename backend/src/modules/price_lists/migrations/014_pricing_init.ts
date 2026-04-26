import { Migration } from '@mikro-orm/migrations';

/**
 * Pricing init (T127). Adds:
 *   - customer_groups
 *   - price_lists
 *   - price_list_items
 *   - price_list_assignments
 *   - organizations.customer_group_id (nullable FK)
 */
export class Migration014PricingInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "customer_groups" (
        "id" uuid not null,
        "code" varchar(64) not null,
        "name" varchar(160) not null,
        "description" varchar(1000) null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "customer_groups_pkey" primary key ("id"),
        constraint "customer_groups_code_unique" unique ("code")
      );
    `);

    this.addSql(`
      create table "price_lists" (
        "id" uuid not null,
        "code" varchar(64) not null,
        "name" varchar(160) not null,
        "currency" varchar(3) not null,
        "is_default" boolean not null default false,
        "priority" int not null default 0,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "price_lists_pkey" primary key ("id"),
        constraint "price_lists_code_unique" unique ("code")
      );
    `);
    this.addSql(
      'create unique index "uniq_price_lists_one_default" on "price_lists" ("is_default") where "is_default" = true;',
    );

    this.addSql(`
      create table "price_list_items" (
        "id" uuid not null,
        "price_list_id" uuid not null,
        "mode" varchar(24) not null,
        "product_id" uuid null,
        "variant_id" uuid null,
        "category_id" uuid null,
        "min_quantity" int not null default 1,
        "unit_price" numeric(14, 4) null,
        "adjustment_value" numeric(14, 4) null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "price_list_items_pkey" primary key ("id"),
        constraint "price_list_items_price_list_fk"
          foreign key ("price_list_id") references "price_lists" ("id") on delete cascade
      );
    `);
    this.addSql('create index "price_list_items_price_list_id_index" on "price_list_items" ("price_list_id");');
    this.addSql('create index "price_list_items_product_id_index" on "price_list_items" ("product_id");');
    this.addSql('create index "price_list_items_category_id_index" on "price_list_items" ("category_id");');
    this.addSql('create index "price_list_items_mode_index" on "price_list_items" ("mode");');

    this.addSql(`
      create table "price_list_assignments" (
        "id" uuid not null,
        "price_list_id" uuid not null,
        "organization_id" uuid null,
        "customer_group_id" uuid null,
        "sales_channel_id" uuid null,
        "is_default" boolean not null default false,
        "priority" int not null default 0,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "price_list_assignments_pkey" primary key ("id"),
        constraint "price_list_assignments_price_list_fk"
          foreign key ("price_list_id") references "price_lists" ("id") on delete cascade
      );
    `);
    this.addSql('create index "price_list_assignments_price_list_id_index" on "price_list_assignments" ("price_list_id");');
    this.addSql('create index "price_list_assignments_organization_id_index" on "price_list_assignments" ("organization_id");');
    this.addSql('create index "price_list_assignments_customer_group_id_index" on "price_list_assignments" ("customer_group_id");');

    this.addSql(
      'alter table "organizations" add column "customer_group_id" uuid null;',
    );
    this.addSql(
      'create index "organizations_customer_group_id_index" on "organizations" ("customer_group_id");',
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop index if exists "organizations_customer_group_id_index";');
    this.addSql('alter table "organizations" drop column if exists "customer_group_id";');
    this.addSql('drop table if exists "price_list_assignments" cascade;');
    this.addSql('drop table if exists "price_list_items" cascade;');
    this.addSql('drop table if exists "price_lists" cascade;');
    this.addSql('drop table if exists "customer_groups" cascade;');
  }
}
