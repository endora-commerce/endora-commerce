import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 068 (Ergonode PIM integration) — widen the product identifier from
 * 64 to 255 characters (research §A5, data-model §12; blocks FR-016 and
 * FR-019, which require every source product to be representable).
 *
 * Ergonode's `Sku` scalar allows up to 255 characters. Endora capped
 * `products.sku` and `product_variants.sku` at `varchar(64)` — created by
 * `backend/src/db/migrations/20260424T165847_core_foundation_init.ts` — so an
 * import would have had to either skip an arbitrary slice of the customer's
 * catalogue or truncate identifiers, and truncation would silently merge two
 * source products sharing a 64-character prefix into one Endora product.
 * Neither is acceptable, so the column is widened instead.
 *
 * These are two of the three `sku` columns in the schema; the third,
 * `product_feed_run_issues.sku`, is widened by its owning `product_feeds`
 * module in the same feature. Everything else references a product by foreign
 * key rather than snapshotting its identifier.
 *
 * Widening a `varchar` in PostgreSQL rewrites only the catalogue — no table
 * rewrite, no index rebuild. The `products_sku_unique` and
 * `product_variants_sku_unique` btree indexes are unaffected: 255 bytes sits
 * far inside the ~2704-byte btree entry limit.
 *
 * **`down()` refuses rather than truncates.** Narrowing back to 64 is only
 * safe while every stored identifier still fits; once a long SKU has been
 * imported, silently cutting it would corrupt the identity of a real product
 * and could collide two of them. The reversal therefore asserts the
 * precondition first and raises a message naming the offending table if it
 * does not hold, leaving the operator to clean up deliberately.
 */
export class Migration20260804T152604CatalogWidenProductSku extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "products" alter column "sku" type varchar(255);`);
    this.addSql(`alter table "product_variants" alter column "sku" type varchar(255);`);
  }

  override async down(): Promise<void> {
    this.addSql(`
      do $$
      declare
        offending bigint;
      begin
        select count(*) into offending from "products" where length("sku") > 64;
        if offending > 0 then
          raise exception
            'Cannot narrow products.sku to varchar(64): % row(s) hold a longer SKU. Shorten or remove them before reverting this migration — truncating would corrupt product identity.',
            offending;
        end if;

        select count(*) into offending from "product_variants" where length("sku") > 64;
        if offending > 0 then
          raise exception
            'Cannot narrow product_variants.sku to varchar(64): % row(s) hold a longer SKU. Shorten or remove them before reverting this migration — truncating would corrupt variant identity.',
            offending;
        end if;
      end
      $$;
    `);
    this.addSql(`alter table "products" alter column "sku" type varchar(64);`);
    this.addSql(`alter table "product_variants" alter column "sku" type varchar(64);`);
  }
}
