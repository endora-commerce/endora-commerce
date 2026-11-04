import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 172 — product content attributes
 * (`specs/172-product-content-attributes/data-model.md` §2, research R-1).
 *
 * `product_content_values` holds one Page Builder value per product × content
 * attribute: `content` is the per-language envelope
 * `{ "languages": { "<code>": <document> } }` (≤ 1 MiB of JSON, every language
 * holding a block — normalised on write), and `summary` is what the product
 * form's card reads instead of the documents,
 * `{ "<code>": { "blocks": n, "excerpt": string | null } }`, derived from
 * `content` on every write and written by nobody else.
 *
 * Apart from `products.attribute_values` on purpose: every reader of ordinary
 * values (search, feeds, comparison, promotions, list reads, "Parametry") is
 * then right by not changing (FR-011).
 *
 * Both foreign keys are this module's own tables and cascade: a product row's
 * removal and an attribute's deletion take their content with them. A product's
 * soft delete leaves the rows in place, unreachable (OR-6).
 *
 * - `unique (product_id, product_attribute_id)` — at most one value per
 *   product × attribute (FR-010); its leading column serves every per-product
 *   read.
 * - `index (product_attribute_id)` — the usage count, the attribute-delete
 *   removal and the cascade.
 * - No index on `content`, as `categories.content` has none: the only query
 *   looking inside it is the asset-reference lookup.
 *
 * `down()` drops the table.
 */
export class Migration20261104T121504CatalogProductContentValues extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "product_content_values" (
        "id" uuid not null,
        "product_id" uuid not null references "products"("id") on delete cascade,
        "product_attribute_id" uuid not null references "product_attributes"("id") on delete cascade,
        "content" jsonb not null,
        "summary" jsonb not null default '{}',
        "created_at" timestamptz not null default now(),
        "updated_at" timestamptz not null default now(),
        constraint "product_content_values_pkey" primary key ("id"),
        constraint "product_content_values_product_attribute_unique" unique ("product_id", "product_attribute_id")
      );
    `);
    this.addSql(
      `create index "product_content_values_product_attribute_idx" on "product_content_values" ("product_attribute_id");`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "product_content_values";`);
  }
}
