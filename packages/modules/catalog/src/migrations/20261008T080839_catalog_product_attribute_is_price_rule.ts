import { Migration } from '@mikro-orm/migrations';

/**
 * Adds `product_attributes.is_price_rule` — whether the attribute may be used
 * as a price-building rule in a Price List.
 *
 * Default `false`, NOT NULL, and the default is the whole backfill: at the
 * time this lands no Price List rule can reference an attribute (the
 * application-rule vocabulary is sales channel / customer group /
 * organization / category / currency), so there is no existing rule whose
 * attribute would have to be switched on to keep working.
 *
 * The flag is owned by `catalog`, like its sibling `is_promo_rule`: a property
 * of the attribute. A pricing consumer reads it through
 * `catalogAttributeReadPort` and never writes it.
 *
 * Side effects on flip: none — it is read live from Postgres.
 */
export class Migration20261008T080839CatalogProductAttributeIsPriceRule extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      alter table "product_attributes"
        add column "is_price_rule" boolean not null default false;
    `);
  }

  override async down(): Promise<void> {
    this.addSql('alter table "product_attributes" drop column if exists "is_price_rule";');
  }
}
