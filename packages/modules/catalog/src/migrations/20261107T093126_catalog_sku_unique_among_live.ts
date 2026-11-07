import { Migration } from '@mikro-orm/migrations';

/**
 * Issue #693 — a deleted product frees its SKU and the SKUs of its variants.
 *
 * `product.delete` is a soft delete with no undo, and `products_sku_unique` /
 * `product_variants_sku_unique` (both `unique ("sku")`, `core_foundation_init`) covered the
 * deleted rows too, so a deleted product's SKU stayed taken for good. The deleted row keeps its
 * real SKU, for audit and ERP/PIM reconciliation; uniqueness now holds among live rows only.
 *
 * 1. `product_variants.deleted_at` — set by the parent's `product.delete` Command, in the same
 *    transaction, to the product's own `deleted_at`. A variant deleted on its own is still a
 *    hard delete.
 * 2. The back-fill: the variants of every product deleted before this migration take their
 *    parent's `deleted_at`, so those SKUs are freed too. Only unmarked variants are touched.
 * 3. Each table-wide constraint is replaced by a partial unique index `where "deleted_at" is
 *    null` — `products_sku_live_unique` and `product_variants_sku_live_unique`. The index is
 *    created before the constraint is dropped, so there is no instant without one. Product and
 *    variant SKUs share one namespace; that rule spans two tables and is the services' to hold
 *    (`findSkuHolder`, the duplicate's `-copy` allocation, the variant create), as before.
 * 4. A plain index on `sku` per table, for the lookups that do not filter on `deleted_at`.
 *
 * Every statement is re-runnable (`if exists` / `if not exists`, a back-fill of unmarked rows
 * only), which is what lets the integration test run `up` again over a deleted product it seeds.
 *
 * `down()` restores the table-wide constraints and drops the column. On a database where a SKU
 * has since been reused it cannot do that: the constraint refuses the duplicate and the
 * transaction rolls back. Remove or rename the deleted duplicates first.
 */
export class Migration20261107T093126CatalogSkuUniqueAmongLive extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "product_variants" add column if not exists "deleted_at" timestamptz null;`);
    this.addSql(
      `update "product_variants" as v
          set "deleted_at" = p."deleted_at"
         from "products" as p
        where p."id" = v."parent_product_id"
          and p."deleted_at" is not null
          and v."deleted_at" is null;`,
    );
    this.addSql(
      `create unique index if not exists "products_sku_live_unique" on "products" ("sku") where "deleted_at" is null;`,
    );
    this.addSql(`alter table "products" drop constraint if exists "products_sku_unique";`);
    this.addSql(
      `create unique index if not exists "product_variants_sku_live_unique" on "product_variants" ("sku") where "deleted_at" is null;`,
    );
    this.addSql(`alter table "product_variants" drop constraint if exists "product_variants_sku_unique";`);
    // The dropped constraints' indexes also served every lookup by SKU that does not filter on
    // `deleted_at` — the read port's default, which history needs. A partial index cannot serve
    // those, so each table keeps a plain one.
    this.addSql(`create index if not exists "products_sku_index" on "products" ("sku");`);
    this.addSql(`create index if not exists "product_variants_sku_index" on "product_variants" ("sku");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "product_variants_sku_index";`);
    this.addSql(`drop index if exists "products_sku_index";`);
    this.addSql(`alter table "product_variants" add constraint "product_variants_sku_unique" unique ("sku");`);
    this.addSql(`drop index if exists "product_variants_sku_live_unique";`);
    this.addSql(`alter table "products" add constraint "products_sku_unique" unique ("sku");`);
    this.addSql(`drop index if exists "products_sku_live_unique";`);
    this.addSql(`alter table "product_variants" drop column if exists "deleted_at";`);
  }
}
