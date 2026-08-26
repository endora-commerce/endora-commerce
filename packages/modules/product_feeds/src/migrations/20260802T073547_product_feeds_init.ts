import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 067 — Product Feed module (init).
 *
 * Creates:
 *  - `product_feed_templates` — reusable, provider-shaped output definitions
 *    (data-model §1). Five ship as system templates addressed by `system_code`.
 *  - `product_feed_template_fields` — the ordered output fields of a template
 *    (data-model §2). The unique `(feed_template_id, output_name)` index is
 *    FR-009's duplicate-name rejection enforced in the database, not only in
 *    the service.
 *  - `product_feeds` — a template bound to a channel/language/currency and
 *    published at a tokenised URL (data-model §3). The unique partial index on
 *    `token_hash` is the public route's only lookup.
 *
 * The pointer columns `published_artefact_id`, `current_run_id` and
 * `last_run_id` are created here but gain their foreign keys in the `runs`
 * migration, which is where the referenced tables come into existence.
 */
export class Migration20260802T073547ProductFeedsInit extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "product_feed_templates" (
        "id" uuid not null,
        "name" varchar(200) not null,
        "description" text null,
        "provider_code" varchar(32) not null default 'custom',
        "output_format" varchar(16) not null default 'xml',
        "item_granularity" varchar(16) not null default 'product',
        "taxonomy_id" uuid null,
        "is_system" boolean not null default false,
        "system_code" varchar(32) null,
        "version" int not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        "deleted_at" timestamptz null,
        constraint "product_feed_templates_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `create unique index "product_feed_templates_name_uq" on "product_feed_templates" ("name") where "deleted_at" is null;`,
    );
    this.addSql(
      `create unique index "product_feed_templates_system_code_uq" on "product_feed_templates" ("system_code") where "system_code" is not null;`,
    );
    this.addSql(
      `create index "product_feed_templates_provider_code_idx" on "product_feed_templates" ("provider_code");`,
    );

    this.addSql(`
      create table "product_feed_template_fields" (
        "id" uuid not null,
        "feed_template_id" uuid not null,
        "output_name" varchar(128) not null,
        "source_kind" varchar(32) not null,
        "source_key" varchar(128) null,
        "constant_value" text null,
        "fallback_value" text null,
        "provider_required" boolean not null default false,
        "transform" varchar(32) null,
        "transform_arg" varchar(64) null,
        "sort_order" int not null default 0,
        "help_key" varchar(128) null,
        "unbound" boolean not null default false,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "product_feed_template_fields_pkey" primary key ("id"),
        constraint "product_feed_template_fields_template_fk"
          foreign key ("feed_template_id") references "product_feed_templates" ("id")
          on update cascade on delete cascade,
        constraint "product_feed_template_fields_constant_ck" check (
          ("source_kind" = 'constant' and "constant_value" is not null and "source_key" is null)
          or ("source_kind" <> 'constant' and "constant_value" is null)
        ),
        constraint "product_feed_template_fields_source_key_ck" check (
          "source_kind" not in ('attribute', 'custom_field') or "source_key" is not null
        )
      );
    `);
    this.addSql(
      `create index "product_feed_template_fields_order_idx" on "product_feed_template_fields" ("feed_template_id", "sort_order");`,
    );
    this.addSql(
      `create unique index "product_feed_template_fields_output_name_uq" on "product_feed_template_fields" ("feed_template_id", "output_name");`,
    );

    this.addSql(`
      create table "product_feeds" (
        "id" uuid not null,
        "name" varchar(200) not null,
        "slug" varchar(160) not null,
        "feed_template_id" uuid not null,
        "sales_channel_id" uuid not null,
        "language_code" varchar(12) not null,
        "currency_code" char(3) not null,
        "price_list_id" uuid null,
        "price_presentation" varchar(8) not null default 'gross',
        "tax_country" char(2) null,
        "selection_rule" jsonb not null default '{"kind":"all"}',
        "schedule_cron" varchar(64) null,
        "schedule_timezone" varchar(64) null,
        "enabled" boolean not null default true,
        "token_hash" char(64) null,
        "token_prefix" varchar(12) null,
        "token_rotated_at" timestamptz null,
        "token_revoked_at" timestamptz null,
        "published_artefact_id" uuid null,
        "current_run_id" uuid null,
        "last_run_id" uuid null,
        "next_run_at" timestamptz null,
        "avg_run_duration_ms" int null,
        "version" int not null default 1,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        constraint "product_feeds_pkey" primary key ("id"),
        constraint "product_feeds_template_fk"
          foreign key ("feed_template_id") references "product_feed_templates" ("id")
          on update cascade on delete restrict,
        constraint "product_feeds_sales_channel_fk"
          foreign key ("sales_channel_id") references "sales_channels" ("id")
          on update cascade on delete restrict,
        constraint "product_feeds_language_fk"
          foreign key ("language_code") references "languages" ("code")
          on update cascade on delete restrict,
        constraint "product_feeds_price_list_fk"
          foreign key ("price_list_id") references "price_lists" ("id")
          on update cascade on delete restrict,
        constraint "product_feeds_schedule_ck" check (
          ("schedule_cron" is null) = ("schedule_timezone" is null)
        ),
        constraint "product_feeds_tax_country_ck" check (
          "price_presentation" <> 'gross' or "tax_country" is not null
        )
      );
    `);
    this.addSql(`create unique index "product_feeds_slug_uq" on "product_feeds" ("slug");`);
    this.addSql(
      `create unique index "product_feeds_token_hash_uq" on "product_feeds" ("token_hash") where "token_hash" is not null;`,
    );
    this.addSql(
      `create index "product_feeds_enabled_idx" on "product_feeds" ("enabled") where "enabled" = true;`,
    );
    this.addSql(
      `create index "product_feeds_sales_channel_id_idx" on "product_feeds" ("sales_channel_id");`,
    );
    this.addSql(
      `create index "product_feeds_feed_template_id_idx" on "product_feeds" ("feed_template_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "product_feeds" cascade;`);
    this.addSql(`drop table if exists "product_feed_template_fields" cascade;`);
    this.addSql(`drop table if exists "product_feed_templates" cascade;`);
  }
}
