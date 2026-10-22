import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { RuleScoped } from '@endora-commerce/platform/tenancy';

/**
 * One product's quantity-1 price for one pricing profile (feature 160, research
 * R7, data-model §6) — what price sort and the price-range filter read. The
 * everyone profile holds every product it prices; any other profile holds only
 * the products whose answer differs from the everyone profile's. `amount` is
 * the card's price (the lowest variant price for a variant product) and
 * `maxAmount` the highest.
 */
@RuleScoped()
@Entity({ tableName: 'price_profile_prices' })
@Index({ properties: ['profileId', 'generation', 'amount', 'productId'], name: 'price_profile_prices_order_idx' })
export class PriceProfilePrice {
  [OptionalProps]?: 'compareAt';

  @PrimaryKey({ type: 'uuid' })
  profileId!: string;

  /** The build these rows belong to; readers see the profile's `servingGeneration` only. */
  @PrimaryKey({ type: 'integer' })
  generation!: number;

  @PrimaryKey({ type: 'uuid' })
  productId!: string;

  @Property({ type: 'decimal', precision: 14, scale: 4 })
  amount!: string;

  @Property({ type: 'decimal', precision: 14, scale: 4 })
  maxAmount!: string;

  @Property({ type: 'decimal', precision: 14, scale: 4, nullable: true })
  compareAt: string | null = null;

  @Property({ type: 'string', length: 16 })
  sourceTier!: 'base' | 'catalogue' | 'buyer' | 'sale';
}
