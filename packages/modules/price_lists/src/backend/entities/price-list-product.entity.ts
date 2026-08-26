import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';

/**
 * PriceListProduct — assignment join between a price list and a product.
 *
 * Composite primary key on `(priceListId, productId)`. The bracket rows in
 * `price_list_price_brackets` cascade off this assignment: removing a product
 * from a list deletes its bracket rows.
 */
@GlobalEntity()
@Entity({ tableName: 'price_list_products' })
export class PriceListProduct {
  [OptionalProps]?: 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  priceListId!: string;

  @PrimaryKey({ type: 'uuid' })
  productId!: string;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  @Index()
  createdAt: Date = new Date();
}
