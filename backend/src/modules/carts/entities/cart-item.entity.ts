import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/** A line in a Cart. Snapshots product info for fast rendering. */
@Entity({ tableName: 'cart_items' })
export class CartItem {
  [OptionalProps]?: 'id' | 'createdAt' | 'updatedAt' | 'variantId';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  cartId!: string;

  @Property({ type: 'uuid' })
  productId!: string;

  @Property({ type: 'uuid', nullable: true })
  variantId?: string | null;

  @Property({ type: 'integer' })
  quantity!: number;

  /** Price snapshot at time of add — services recalculate at checkout. */
  @Property({ type: 'decimal', precision: 12, scale: 2 })
  unitPrice!: string;

  @Property({ type: 'string', length: 3 })
  currency!: string;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
