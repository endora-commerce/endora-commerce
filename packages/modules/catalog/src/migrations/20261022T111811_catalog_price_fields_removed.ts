import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 160 (FR-042; `specs/160-pricing-model-v2/contracts/conversion-and-removal.md`
 * §2) — a product has no price of its own any more: a price is a row of a
 * price book (D-287 §5.8). The two catalogue fields that looked like one are
 * removed, **not converted** (owner ruling 2026-10-21):
 *
 * - `product_variants.price_override` is dropped. It was never charged
 *   (`specs/pricing/current-model.md`), so converting it would have turned a
 *   number nobody paid into a price.
 * - the `defaultPrice` and `price` keys are stripped from
 *   `products.attribute_values`. The product *default price* mattered only for
 *   a product the Default list had no bracket for; `price_lists`' conversion
 *   turns those brackets into base-book rows, and reads nothing of this table.
 *
 * Every `catalog` migration runs before every `price_lists` one (module order,
 * `specs/conventions/module-migrations.md` item 3), which is why nothing may
 * convert from these fields in the same release, and nothing does.
 *
 * `down` gives the column back, empty; the stripped keys are not restored.
 */
export class Migration20261022T111811CatalogPriceFieldsRemoved extends Migration {
  override async up(): Promise<void> {
    this.addSql(`alter table "product_variants" drop column if exists "price_override";`);
    this.addSql(
      `update "products" set "attribute_values" = "attribute_values" - 'defaultPrice' - 'price'
        where ("attribute_values" - 'defaultPrice' - 'price') <> "attribute_values";`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "product_variants" add column if not exists "price_override" numeric(12,2) null;`);
  }
}
