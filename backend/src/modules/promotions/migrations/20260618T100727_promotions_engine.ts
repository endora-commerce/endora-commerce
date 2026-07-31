import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 045 — promotions rules engine.
 *
 * Schema changes (one atomic migration):
 *   - ALTER `promotions`: relax `kind` / `value` to nullable (action-based
 *     promotions carry no legacy effect); add engine columns (description,
 *     priority, stop_further, action_type, action_config, rule_id,
 *     rule_definition, usage limits).
 *   - new tables: promotion_rules, coupon_batches, promotion_coupons,
 *     promotion_usages, promotion_usage_counters (with indexes/uniques per
 *     data-model.md).
 *   - backfill legacy `promotions.code` into a `promotion_coupons` row.
 */
export class Migration20260618T100727PromotionsEngine extends Migration {
  override async up(): Promise<void> {
    // 1) promotions — relax legacy columns + add engine columns
    this.addSql(`alter table "promotions" alter column "kind" drop not null;`);
    this.addSql(`alter table "promotions" alter column "value" drop not null;`);
    this.addSql(`alter table "promotions" add column "description" text null;`);
    this.addSql(`alter table "promotions" add column "priority" integer not null default 0;`);
    this.addSql(`alter table "promotions" add column "stop_further" boolean not null default false;`);
    this.addSql(`alter table "promotions" add column "action_type" varchar(64) null;`);
    this.addSql(`alter table "promotions" add column "action_config" jsonb not null default '{}';`);
    this.addSql(`alter table "promotions" add column "rule_id" uuid null;`);
    this.addSql(`alter table "promotions" add column "rule_definition" jsonb null;`);
    this.addSql(`alter table "promotions" add column "usage_limit_global" integer null;`);
    this.addSql(`alter table "promotions" add column "usage_limit_per_organization" integer null;`);
    this.addSql(`alter table "promotions" add column "usage_limit_per_customer" integer null;`);
    this.addSql(`create index "idx_promotions_priority" on "promotions" ("priority");`);
    this.addSql(`create index "idx_promotions_rule_id" on "promotions" ("rule_id");`);
    this.addSql(`create index "idx_promotions_validity" on "promotions" ("valid_from", "valid_until");`);

    // 2) promotion_rules — standalone named rules
    this.addSql(`
      create table "promotion_rules" (
        "id" uuid not null,
        "name" varchar(160) not null,
        "description" text null,
        "definition" jsonb not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "promotion_rules_pkey" primary key ("id")
      );
    `);
    this.addSql(`alter table "promotion_rules" add constraint "promotion_rules_name_unique" unique ("name");`);
    this.addSql(
      `alter table "promotions" add constraint "promotions_rule_id_foreign" foreign key ("rule_id") references "promotion_rules" ("id") on update cascade on delete set null;`,
    );

    // 3) coupon_batches — generator config
    this.addSql(`
      create table "coupon_batches" (
        "id" uuid not null,
        "promotion_id" uuid not null,
        "count" integer not null,
        "length" integer not null,
        "format" varchar(16) not null,
        "prefix" varchar(32) null,
        "suffix" varchar(32) null,
        "dash_every" integer not null default 0,
        "limit_scope" varchar(16) not null,
        "created_at" timestamptz not null,
        constraint "coupon_batches_pkey" primary key ("id")
      );
    `);
    this.addSql(`create index "idx_coupon_batches_promotion" on "coupon_batches" ("promotion_id");`);
    this.addSql(
      `alter table "coupon_batches" add constraint "coupon_batches_promotion_id_foreign" foreign key ("promotion_id") references "promotions" ("id") on update cascade on delete cascade;`,
    );

    // 4) promotion_coupons — individual codes
    this.addSql(`
      create table "promotion_coupons" (
        "id" uuid not null,
        "promotion_id" uuid not null,
        "batch_id" uuid null,
        "code" varchar(80) not null,
        "limit_scope" varchar(16) not null,
        "is_active" boolean not null default true,
        "created_at" timestamptz not null,
        constraint "promotion_coupons_pkey" primary key ("id")
      );
    `);
    this.addSql(`alter table "promotion_coupons" add constraint "promotion_coupons_code_unique" unique ("code");`);
    this.addSql(`create index "idx_promotion_coupons_promotion" on "promotion_coupons" ("promotion_id");`);
    this.addSql(`create index "idx_promotion_coupons_batch" on "promotion_coupons" ("batch_id");`);
    this.addSql(
      `alter table "promotion_coupons" add constraint "promotion_coupons_promotion_id_foreign" foreign key ("promotion_id") references "promotions" ("id") on update cascade on delete cascade;`,
    );
    this.addSql(
      `alter table "promotion_coupons" add constraint "promotion_coupons_batch_id_foreign" foreign key ("batch_id") references "coupon_batches" ("id") on update cascade on delete set null;`,
    );

    // 5) promotion_usages — finalized redemptions (statistics source)
    this.addSql(`
      create table "promotion_usages" (
        "id" uuid not null,
        "promotion_id" uuid not null,
        "coupon_id" uuid null,
        "order_id" uuid not null,
        "customer_account_id" uuid null,
        "organization_id" uuid null,
        "customer_group_id" uuid null,
        "sales_channel_id" uuid not null,
        "discount_amount" numeric(14,2) not null,
        "currency" varchar(3) not null,
        "created_at" timestamptz not null,
        constraint "promotion_usages_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `alter table "promotion_usages" add constraint "promotion_usages_order_promotion_unique" unique ("order_id", "promotion_id");`,
    );
    this.addSql(`create index "idx_promotion_usages_promotion" on "promotion_usages" ("promotion_id", "created_at");`);
    this.addSql(`create index "idx_promotion_usages_coupon" on "promotion_usages" ("coupon_id");`);
    this.addSql(`create index "idx_promotion_usages_customer" on "promotion_usages" ("customer_account_id");`);
    this.addSql(`create index "idx_promotion_usages_organization" on "promotion_usages" ("organization_id");`);
    this.addSql(`create index "idx_promotion_usages_group" on "promotion_usages" ("customer_group_id");`);
    this.addSql(`create index "idx_promotion_usages_channel" on "promotion_usages" ("sales_channel_id");`);

    // 6) promotion_usage_counters — atomic cap enforcement
    this.addSql(`
      create table "promotion_usage_counters" (
        "id" uuid not null,
        "scope_type" varchar(16) not null,
        "scope_key" varchar(128) not null,
        "count" integer not null default 0,
        constraint "promotion_usage_counters_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `alter table "promotion_usage_counters" add constraint "promotion_usage_counters_scope_unique" unique ("scope_type", "scope_key");`,
    );

    // 7) backfill legacy promotions.code → promotion_coupons
    this.addSql(`
      insert into "promotion_coupons" ("id", "promotion_id", "batch_id", "code", "limit_scope", "is_active", "created_at")
      select gen_random_uuid(), "id", null, "code", 'per_coupon', true, now()
      from "promotions"
      where "code" is not null;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "promotion_usage_counters";`);
    this.addSql(`drop table if exists "promotion_usages";`);
    this.addSql(`drop table if exists "promotion_coupons";`);
    this.addSql(`drop table if exists "coupon_batches";`);
    this.addSql(`alter table "promotions" drop constraint if exists "promotions_rule_id_foreign";`);
    this.addSql(`drop table if exists "promotion_rules";`);
    this.addSql(`drop index if exists "idx_promotions_priority";`);
    this.addSql(`drop index if exists "idx_promotions_rule_id";`);
    this.addSql(`drop index if exists "idx_promotions_validity";`);
    this.addSql(`alter table "promotions" drop column "description";`);
    this.addSql(`alter table "promotions" drop column "priority";`);
    this.addSql(`alter table "promotions" drop column "stop_further";`);
    this.addSql(`alter table "promotions" drop column "action_type";`);
    this.addSql(`alter table "promotions" drop column "action_config";`);
    this.addSql(`alter table "promotions" drop column "rule_id";`);
    this.addSql(`alter table "promotions" drop column "rule_definition";`);
    this.addSql(`alter table "promotions" drop column "usage_limit_global";`);
    this.addSql(`alter table "promotions" drop column "usage_limit_per_organization";`);
    this.addSql(`alter table "promotions" drop column "usage_limit_per_customer";`);
  }
}
