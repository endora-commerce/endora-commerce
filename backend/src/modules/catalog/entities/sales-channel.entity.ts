import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * Sales Channel — market/segment view onto the catalog (FR-106).
 * `isPublic=true` exposes catalog + prices without login (R-18); non-public
 * channels strip price fields from anonymous responses.
 *
 * Join tables (sales_channel_products, sales_channel_price_lists,
 * sales_channel_delivery_methods, sales_channel_payment_methods) managed by
 * migrations.
 */
@Entity({ tableName: 'sales_channels' })
export class SalesChannel {
  [OptionalProps]?: 'id' | 'createdAt' | 'updatedAt' | 'isPublic' | 'status';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 32 })
  @Unique()
  code!: string;

  @Property({ type: 'json' })
  name!: Record<string, string>;

  @Property({ type: 'boolean' })
  isPublic: boolean = false;

  @Property({ type: 'string', length: 10 })
  defaultLanguage!: string;

  @Property({ type: 'string', length: 3 })
  defaultCurrency!: string;

  @Property({ type: 'string', length: 16 })
  status: 'active' | 'inactive' = 'active';

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
