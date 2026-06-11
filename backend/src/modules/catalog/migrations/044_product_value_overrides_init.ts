import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 022 / Product Scope Editor — per Sales Channel + per Language.
 *
 * Three schema changes shipped atomically:
 *
 *   1. Add `channel_scoped` and `language_scoped` boolean flags to
 *      `product_attributes`. Both default to `false` so all existing
 *      attributes behave as global-only — the new scope dimensions are
 *      opt-in per attribute. System attributes `name` and `description`
 *      are NOT rows in `product_attributes`; their scope is hard-coded
 *      in `SYSTEM_ATTRIBUTE_SCOPES` (see
 *      services/system-attribute-scopes.ts).
 *
 *   2. Create `product_value_overrides`. Holds the channel-aware slots
 *      (channel-only and channel+language) for every attribute whose
 *      scope flags permit them. The global baseline still lives in
 *      `products.name` / `products.description` JSONB (per-language)
 *      and `products.attribute_values` JSONB (per-attribute) — this
 *      migration does NOT touch the baseline storage.
 *
 *      `language_code` is NULLABLE — a NULL means "channel-only override
 *      (no language scope)"; a non-null means "channel + language slot".
 *      Two partial UNIQUE indexes model the rule "tuple is unique
 *      regardless of whether language_code is null".
 *
 *   3. Create `product_editor_preferences`. Per-(admin user, product)
 *      memory of the last-selected Sales Channel + Language on the
 *      product edit page so the switchers seed back to the editor's
 *      previous context on return.
 *
 * See specs/023-product-scope-editor/data-model.md §1.
 */
export class Migration044ProductValueOverridesInit extends Migration {
  override async up(): Promise<void> {
    // 1. Scope flags on product_attributes (opt-in, default false).
    this.addSql(`
      alter table "product_attributes"
        add column "channel_scoped" boolean not null default false,
        add column "language_scoped" boolean not null default false;
    `);

    // 2. product_value_overrides — channel-aware slots.
    this.addSql(`
      create table "product_value_overrides" (
        "id" uuid primary key default gen_random_uuid(),
        "product_id" uuid not null references "products"("id") on delete cascade,
        "attribute_key" varchar(64) not null,
        "channel_id" uuid not null references "sales_channels"("id") on delete cascade,
        "language_code" varchar(16) null,
        "value" jsonb not null,
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now()
      );
    `);

    // Partial UNIQUE indexes — model "tuple unique regardless of NULL
    // semantics" via two complementary partial indexes.
    this.addSql(`
      create unique index "product_value_overrides_channel_only_uniq"
        on "product_value_overrides" ("product_id", "attribute_key", "channel_id")
        where "language_code" is null;
    `);
    this.addSql(`
      create unique index "product_value_overrides_channel_lang_uniq"
        on "product_value_overrides" ("product_id", "attribute_key", "channel_id", "language_code")
        where "language_code" is not null;
    `);
    // Per-product per-attribute lookup index for the resolver's batch fetch.
    this.addSql(`
      create index "product_value_overrides_product_attr_idx"
        on "product_value_overrides" ("product_id", "attribute_key");
    `);

    // 3. product_editor_preferences — per-editor switcher memory.
    this.addSql(`
      create table "product_editor_preferences" (
        "admin_user_id" uuid not null references "admin_users"("id") on delete cascade,
        "product_id" uuid not null references "products"("id") on delete cascade,
        "last_channel_id" uuid null,
        "last_language_code" varchar(16) null,
        "updated_at" timestamptz not null default now(),
        constraint "product_editor_preferences_pkey"
          primary key ("admin_user_id", "product_id")
      );
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "product_editor_preferences";`);
    this.addSql(`drop index if exists "product_value_overrides_product_attr_idx";`);
    this.addSql(`drop index if exists "product_value_overrides_channel_lang_uniq";`);
    this.addSql(`drop index if exists "product_value_overrides_channel_only_uniq";`);
    this.addSql(`drop table if exists "product_value_overrides";`);
    this.addSql(`
      alter table "product_attributes"
        drop column if exists "language_scoped",
        drop column if exists "channel_scoped";
    `);
  }
}
