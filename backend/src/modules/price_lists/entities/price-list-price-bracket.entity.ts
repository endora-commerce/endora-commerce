import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';

/**
 * PriceListPriceBracket — one bracket row inside a price list for a given
 * `(product, currency)` pair.
 *
 * Composite primary key on `(priceListId, productId, currencyCode, minQuantity)`
 * which guarantees a unique starting point per series. Overlap-freedom across
 * brackets within the same `(list, product, currency)` triplet is enforced at
 * the service layer (research §R3) — not at the DB — so the API can return a
 * structured `400 bracket_overlap` error.
 *
 * `maxQuantity = null` is the open-ended top bracket. `amount` is decimal(14,4)
 * stored as a string to preserve precision through the wire and the ORM.
 */
@Entity({ tableName: 'price_list_price_brackets' })
export class PriceListPriceBracket {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'maxQuantity';

  @PrimaryKey({ type: 'uuid' })
  priceListId!: string;

  @PrimaryKey({ type: 'uuid' })
  productId!: string;

  @PrimaryKey({ type: 'string', length: 3 })
  currencyCode!: string;

  @PrimaryKey({ type: 'integer' })
  minQuantity!: number;

  @Property({ type: 'integer', nullable: true })
  maxQuantity?: number | null;

  @Property({ type: 'decimal', precision: 14, scale: 4 })
  amount!: string;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
