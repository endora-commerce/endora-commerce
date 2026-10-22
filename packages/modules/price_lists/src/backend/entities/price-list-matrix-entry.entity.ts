import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import { RuleScoped } from '@endora-commerce/platform/tenancy';

/**
 * PriceListMatrixEntry — one **row of a price book** (feature 160, D-287 P1;
 * `data-model.md` §4): a selection (variant, product, category ∩ attribute,
 * category, attribute, all), a quantity window and a price — `fixed`
 * (`amount`), `percent` (a signed `percent` of the reference: price =
 * reference × (1 + percent/100)) or `amount` (a signed adjustment in
 * `amount`). The selection kind is derived from which coordinates are set and
 * is never stored. The header carries the currency and the audience, so a row
 * names neither; the old model's `organization_id`, `currency_code` and
 * `discount_percent` were dropped by the conversion migration. The table keeps
 * its feature-148 name (research R3).
 *
 * **`@RuleScoped()`**: a row is a price coordinate, not a tenant's row; the
 * storefront reads only the rows of the books that apply to the buyer.
 *
 * Shape rules are CHECK constraints in the migrations and the price-book
 * rules (`price-book-rules.ts`); amounts and percentages are decimal strings,
 * never floats.
 */
@RuleScoped()
@Entity({ tableName: 'price_list_matrix_entries' })
@Index({ properties: ['priceListId', 'productId'], name: 'price_list_matrix_entries_list_product_idx' })
export class PriceListMatrixEntry {
  [OptionalProps]?:
    | 'id'
    | 'productId'
    | 'categoryId'
    | 'attributeKey'
    | 'attributeValue'
    | 'maxQuantity'
    | 'amount'
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

  @Property({ type: 'integer' })
  minQuantity!: number;

  @Property({ type: 'integer', nullable: true })
  maxQuantity: number | null = null;

  @Property({ type: 'string', length: 16 })
  priceType!: 'fixed' | 'percent' | 'amount';

  @Property({ type: 'decimal', precision: 14, scale: 4, nullable: true })
  amount: string | null = null;

  /** Feature 160 — signed: price = reference × (1 + percent / 100), −100 ≤ percent ≤ 1000. */
  @Property({ type: 'decimal', precision: 7, scale: 2, nullable: true })
  percent: string | null = null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
