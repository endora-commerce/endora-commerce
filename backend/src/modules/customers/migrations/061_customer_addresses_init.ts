import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 040 (Customers) US2 — the personal address book.
 *
 * Mirrors the org-level `addresses` table but keyed by `customer_account_id`,
 * so standalone (org-less) customers can keep their own billing/delivery
 * addresses. "At most one default per (customer, kind)" is enforced by a
 * partial unique index, exactly like `addresses`.
 */
export class Migration061CustomerAddressesInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "customer_addresses" (
        "id" uuid not null,
        "customer_account_id" uuid not null,
        "kind" varchar(16) not null,
        "recipient_name" varchar(160) not null,
        "street" varchar(255) not null,
        "city" varchar(120) not null,
        "postal_code" varchar(20) not null,
        "country" varchar(2) not null,
        "phone" varchar(32) null,
        "is_default" boolean not null default false,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        "deleted_at" timestamptz null,
        constraint "customer_addresses_pkey" primary key ("id"),
        constraint "customer_addresses_customer_fk" foreign key ("customer_account_id")
          references "customer_accounts" ("id") on delete cascade
      );
    `);
    this.addSql(
      'create index "customer_addresses_customer_account_id_index" on "customer_addresses" ("customer_account_id");',
    );
    this.addSql(
      'create index "customer_addresses_kind_index" on "customer_addresses" ("kind");',
    );
    this.addSql(
      `create unique index "customer_addresses_one_default_per_kind" on "customer_addresses" ("customer_account_id", "kind") where "is_default" = true and "deleted_at" is null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "customer_addresses" cascade;');
  }
}
