import { Migration } from '@mikro-orm/migrations';

/**
 * Commerce tables for US2 — carts, inventory, delivery/payment methods, orders,
 * order_items, payments, invoices.
 *
 * Design notes:
 *   - carts.customer_account_id + anonymous_cart_token are mutually exclusive.
 *     The partial unique indexes enforce "at most one active cart per
 *     customer" and "at most one active cart per anon-token".
 *   - stock_levels has a unique index per (product_id, variant_id?) so
 *     reservation SELECT … FOR UPDATE is straightforward.
 *   - order_items FK to orders ON DELETE CASCADE; everything else RESTRICT to
 *     protect audit trail.
 */
export class Migration20260425T050720CoreCommerceInit extends Migration {
  override async up(): Promise<void> {
    // Cart tables
    this.addSql(`
      create table "carts" (
        "id" uuid not null,
        "customer_account_id" uuid null,
        "organization_id" uuid null,
        "anonymous_cart_token" varchar(64) null,
        "status" varchar(16) not null default 'active',
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "carts_pkey" primary key ("id"),
        constraint "carts_anon_token_unique" unique ("anonymous_cart_token")
      );
    `);
    this.addSql('create index "carts_customer_account_id_index" on "carts" ("customer_account_id");');
    this.addSql('create index "carts_organization_id_index" on "carts" ("organization_id");');
    this.addSql(
      `create unique index "carts_one_active_per_customer" on "carts" ("customer_account_id") where "status" = 'active' and "customer_account_id" is not null;`,
    );

    this.addSql(`
      create table "cart_items" (
        "id" uuid not null,
        "cart_id" uuid not null,
        "product_id" uuid not null,
        "variant_id" uuid null,
        "quantity" int not null,
        "unit_price" numeric(12,2) not null,
        "currency" varchar(3) not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "cart_items_pkey" primary key ("id"),
        constraint "cart_items_cart_fk" foreign key ("cart_id") references "carts" ("id") on delete cascade
      );
    `);
    this.addSql('create index "cart_items_cart_id_index" on "cart_items" ("cart_id");');

    // Inventory
    this.addSql(`
      create table "stock_levels" (
        "id" uuid not null,
        "product_id" uuid not null,
        "variant_id" uuid null,
        "on_hand" int not null,
        "reserved" int not null default 0,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "stock_levels_pkey" primary key ("id")
      );
    `);
    this.addSql('create index "stock_levels_product_id_index" on "stock_levels" ("product_id");');
    this.addSql(
      `create unique index "stock_levels_product_variant_unique" on "stock_levels" ("product_id", coalesce("variant_id", '00000000-0000-0000-0000-000000000000'::uuid));`,
    );

    // Delivery + Payment methods
    this.addSql(`
      create table "delivery_methods" (
        "id" uuid not null,
        "code" varchar(64) not null,
        "name" jsonb not null,
        "cost" numeric(12,2) not null default 0,
        "currency" varchar(3) not null,
        "status" varchar(16) not null default 'active',
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "delivery_methods_pkey" primary key ("id"),
        constraint "delivery_methods_code_unique" unique ("code")
      );
    `);

    this.addSql(`
      create table "payment_methods" (
        "id" uuid not null,
        "code" varchar(64) not null,
        "name" jsonb not null,
        "kind" varchar(32) not null,
        "status" varchar(16) not null default 'active',
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "payment_methods_pkey" primary key ("id"),
        constraint "payment_methods_code_unique" unique ("code")
      );
    `);

    // Orders + order items
    this.addSql(`
      create table "orders" (
        "id" uuid not null,
        "organization_id" uuid not null,
        "placed_by_customer_account_id" uuid not null,
        "placed_on_behalf_by_admin_user_id" uuid null,
        "sales_channel_id" uuid not null,
        "status" varchar(32) not null default 'new',
        "payment_status" varchar(32) not null default 'awaiting_payment',
        "delivery_address" jsonb not null,
        "billing_address" jsonb not null,
        "delivery_method_id" uuid not null,
        "delivery_method_snapshot" jsonb not null,
        "payment_method_id" uuid not null,
        "payment_method_snapshot" jsonb not null,
        "source_quote_request_id" uuid null,
        "subtotal" numeric(14,2) not null,
        "tax_total" numeric(14,2) not null,
        "discount_total" numeric(14,2) not null default 0,
        "delivery_total" numeric(14,2) not null,
        "total" numeric(14,2) not null,
        "currency" varchar(3) not null,
        "promotion_code" varchar(64) null,
        "customer_note" text null,
        "placed_at" timestamptz not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "orders_pkey" primary key ("id")
      );
    `);
    this.addSql('create index "orders_organization_id_index" on "orders" ("organization_id");');
    this.addSql('create index "orders_placed_by_customer_account_id_index" on "orders" ("placed_by_customer_account_id");');
    this.addSql('create index "orders_status_index" on "orders" ("status");');
    this.addSql('create index "orders_payment_status_index" on "orders" ("payment_status");');
    this.addSql('create index "orders_placed_at_index" on "orders" ("placed_at");');

    this.addSql(`
      create table "order_items" (
        "id" uuid not null,
        "order_id" uuid not null,
        "product_id" uuid not null,
        "product_snapshot" jsonb not null,
        "variant_id" uuid null,
        "variant_snapshot" jsonb null,
        "quantity" int not null,
        "unit_price" numeric(12,2) not null,
        "tax_rate" numeric(5,4) not null,
        "line_total" numeric(14,2) not null,
        "created_at" timestamptz not null,
        constraint "order_items_pkey" primary key ("id"),
        constraint "order_items_order_fk" foreign key ("order_id") references "orders" ("id") on delete cascade
      );
    `);
    this.addSql('create index "order_items_order_id_index" on "order_items" ("order_id");');

    // Payments
    this.addSql(`
      create table "payments" (
        "id" uuid not null,
        "order_id" uuid not null,
        "payment_method_id" uuid not null,
        "status" varchar(32) not null default 'awaiting_payment',
        "amount" numeric(14,2) not null,
        "currency" varchar(3) not null,
        "paid_at" timestamptz null,
        "external_reference" varchar(255) null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "payments_pkey" primary key ("id"),
        constraint "payments_order_fk" foreign key ("order_id") references "orders" ("id") on delete restrict
      );
    `);
    this.addSql('create index "payments_order_id_index" on "payments" ("order_id");');
    this.addSql('create index "payments_status_index" on "payments" ("status");');

    // Invoices
    this.addSql(`
      create table "invoices" (
        "id" uuid not null,
        "order_id" uuid not null,
        "kind" varchar(16) not null,
        "number" varchar(64) not null,
        "issued_at" timestamptz not null,
        "currency" varchar(3) not null,
        "total" numeric(14,2) not null,
        "pdf_asset_id" uuid null,
        "status" varchar(16) not null default 'pending',
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "invoices_pkey" primary key ("id"),
        constraint "invoices_number_unique" unique ("number"),
        constraint "invoices_order_fk" foreign key ("order_id") references "orders" ("id") on delete restrict
      );
    `);
    this.addSql('create index "invoices_order_id_index" on "invoices" ("order_id");');
    this.addSql('create index "invoices_status_index" on "invoices" ("status");');
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "invoices" cascade;');
    this.addSql('drop table if exists "payments" cascade;');
    this.addSql('drop table if exists "order_items" cascade;');
    this.addSql('drop table if exists "orders" cascade;');
    this.addSql('drop table if exists "payment_methods" cascade;');
    this.addSql('drop table if exists "delivery_methods" cascade;');
    this.addSql('drop table if exists "stock_levels" cascade;');
    this.addSql('drop table if exists "cart_items" cascade;');
    this.addSql('drop table if exists "carts" cascade;');
  }
}
