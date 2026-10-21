import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import { RuleScoped } from '@endora-commerce/platform/tenancy';

/**
 * PriceListMatrixEntry — one cell of a price list's price matrix (feature 148),
 * and since feature 160 (D-287 P1) one **row of a price book**: a selection
 * (variant, product, category ∩ attribute, category, attribute, all), a
 * quantity window and a price — `fixed` (`amount`), `percent` (a signed
 * `percent` of the reference) or `amount` (a signed adjustment in `amount`).
 * A price-book row names neither an organization nor a currency (the header
 * does); those two columns and the legacy `discount_percent` arm stay until the
 * conversion migration.
 *
 * Prices a *selection* of products — one product, a category, an attribute
 * value, a category and an attribute value, or every product — for an optional
 * organization and a quantity window, at a fixed unit price in one currency or
 * a percentage off the reference price. The selection kind is derived from
 * which coordinates are set (`priceMatrixSelectionKind` in contracts) and is
 * never stored.
 *
 * **`@RuleScoped()`** (research R12): the organization is a nullable price
 * coordinate, not a tenant column. `@OrgScoped()` would hide the
 * not-organization-specific entries every buyer needs; the admin surface
 * filters by `ruleVisibleForScope` instead, and storefront resolution reads the
 * entries unfiltered — the coordinate *is* the buyer match, as it is for the
 * list's own application rule.
 *
 * Shape rules are CHECK constraints in the migration and Zod refinements in
 * contracts; amounts and percentages are decimal strings, never floats.
 */
@RuleScoped()
@Entity({ tableName: 'price_list_matrix_entries' })
@Index({ properties: ['priceListId', 'productId'], name: 'price_list_matrix_entries_list_product_idx' })
@Index({ properties: ['priceListId', 'organizationId'], name: 'price_list_matrix_entries_list_org_idx' })
export class PriceListMatrixEntry {
  [OptionalProps]?:
    | 'id'
    | 'productId'
    | 'categoryId'
    | 'attributeKey'
    | 'attributeValue'
    | 'organizationId'
    | 'maxQuantity'
    | 'amount'
    | 'currencyCode'
    | 'discountPercent'
    | 'variantId'
    | 'percent'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  priceListId!: string;

  /** Feature 160 — the variant a row prices; `productId` is then its parent. */
  @Property({ type: 'uuid', nullable: true })
  variantId: string | null = null;

  @Property({ type: 'uuid', nullable: true })
  productId: string | null = null;

  @Property({ type: 'uuid', nullable: true })
  categoryId: string | null = null;

  @Property({ type: 'string', length: 64, nullable: true })
  attributeKey: string | null = null;

  @Property({ type: 'string', length: 255, nullable: true })
  attributeValue: string | null = null;

  @Property({ type: 'uuid', nullable: true })
  organizationId: string | null = null;

  @Property({ type: 'integer' })
  minQuantity!: number;

  @Property({ type: 'integer', nullable: true })
  maxQuantity: number | null = null;

  @Property({ type: 'string', length: 16 })
  priceType!: 'fixed' | 'percent' | 'amount' | 'discount_percent';

  @Property({ type: 'decimal', precision: 14, scale: 4, nullable: true })
  amount: string | null = null;

  @Property({ type: 'string', length: 3, columnType: 'char(3)', nullable: true })
  currencyCode: string | null = null;

  @Property({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  discountPercent: string | null = null;

  /** Feature 160 — signed: price = reference × (1 + percent / 100), −100 ≤ percent ≤ 1000. */
  @Property({ type: 'decimal', precision: 7, scale: 2, nullable: true })
  percent: string | null = null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
