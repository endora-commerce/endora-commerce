import { Migration } from '@mikro-orm/migrations';

/**
 * Tax + Promotion init (T128, T129). Two tables, both keyed by their
 * own UUID; `taxes.code` and `promotions.code` are unique. The default
 * tax invariant is enforced by a partial unique index.
 *
 * Co-located in the `taxes` module folder to keep the migration
 * sequence numerical.
 */
export class Migration015TaxesPromotionsInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "taxes" (
        "id" uuid not null,
        "code" varchar(64) not null,
        "name" varchar(160) not null,
        "rate" numeric(6, 4) not null,
        "country" varchar(2) null,
        "product_type" varchar(16) null,
        "applies_to_vat_statuses" jsonb not null default '[]'::jsonb,
        "is_default" boolean not null default false,
        "priority" int not null default 0,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "taxes_pkey" primary key ("id"),
        constraint "taxes_code_unique" unique ("code")
      );
    `);
    this.addSql('create index "taxes_country_index" on "taxes" ("country");');
    this.addSql(
      'create unique index "uniq_taxes_one_default" on "taxes" ("is_default") where "is_default" = true;',
    );

    this.addSql(`
      create table "promotions" (
        "id" uuid not null,
        "code" varchar(64) null,
        "name" varchar(160) not null,
        "kind" varchar(24) not null,
        "value" numeric(14, 4) not null,
        "currency" varchar(3) null,
        "min_cart_subtotal" numeric(14, 2) null,
        "valid_from" timestamptz null,
        "valid_until" timestamptz null,
        "organization_id" uuid null,
        "customer_group_id" uuid null,
        "category_id" uuid null,
        "product_id" uuid null,
        "is_active" boolean not null default true,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "promotions_pkey" primary key ("id"),
        constraint "promotions_code_unique" unique ("code")
      );
    `);
    this.addSql('create index "promotions_kind_index" on "promotions" ("kind");');
    this.addSql('create index "promotions_organization_id_index" on "promotions" ("organization_id");');
    this.addSql('create index "promotions_customer_group_id_index" on "promotions" ("customer_group_id");');
    this.addSql('create index "promotions_is_active_index" on "promotions" ("is_active");');
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists "promotions" cascade;');
    this.addSql('drop table if exists "taxes" cascade;');
  }
}
