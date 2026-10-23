import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { RuleScoped } from '@endora-commerce/platform/tenancy';

/**
 * A (profile, product) mark of the price surface (feature 160,
 * `contracts/price-surface.md` §4): a pricing write moved this product's price
 * for this profile, and the surface worker has not re-resolved it yet. The
 * profile keeps serving its row meanwhile. Only ever inserted by the writers'
 * marking (a second write is a second row) and deleted by the worker's
 * refresh, by id — only the marks a pass read, so a write landing during a
 * pass survives for the next pass, and no writer and refresh lock one row.
 */
@RuleScoped()
@Entity({ tableName: 'price_profile_stale_products' })
@Index({ properties: ['profileId'], name: 'price_profile_stale_products_profile_idx' })
export class PriceProfileStaleProduct {
  [OptionalProps]?: 'id' | 'markedAt';

  @PrimaryKey({ type: 'bigint', autoincrement: true })
  id!: string;

  @Property({ type: 'uuid' })
  profileId!: string;

  @Property({ type: 'uuid' })
  productId!: string;

  @Property({ type: 'datetime' })
  markedAt: Date = new Date();
}
