import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * PriceListItem — a single rule inside a PriceList. Discriminated by `mode`:
 *
 *   - `fixed_unit`     : `productId` (+ optional `variantId`) → `unitPrice`
 *                        in the parent list's currency. `minQuantity` lets
 *                        a single price list carry volume tiers per product.
 *   - `percentage_off` : `categoryId` + `adjustmentValue` (0..100) — every
 *                        product in the category gets a discount on top of
 *                        its base price.
 *   - `amount_off`     : `categoryId` + `adjustmentValue` (money) — flat
 *                        per-unit amount off the base price.
 *
 * Per-row CHECK constraints are enforced at the service layer rather than in
 * SQL so the contract layer can return validation issues with full path
 * information.
 */
@Entity({ tableName: 'price_list_items' })
export class PriceListItem {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'minQuantity'
    | 'productId'
    | 'variantId'
    | 'categoryId'
    | 'unitPrice'
    | 'adjustmentValue';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  priceListId!: string;

  @Property({ type: 'string', length: 24 })
  @Index()
  mode!: 'fixed_unit' | 'percentage_off' | 'amount_off';

  @Property({ type: 'uuid', nullable: true })
  @Index()
  productId?: string | null;

  @Property({ type: 'uuid', nullable: true })
  variantId?: string | null;

  @Property({ type: 'uuid', nullable: true })
  @Index()
  categoryId?: string | null;

  @Property({ type: 'integer' })
  minQuantity: number = 1;

  @Property({ type: 'decimal', precision: 14, scale: 4, nullable: true })
  unitPrice?: string | null;

  @Property({ type: 'decimal', precision: 14, scale: 4, nullable: true })
  adjustmentValue?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
