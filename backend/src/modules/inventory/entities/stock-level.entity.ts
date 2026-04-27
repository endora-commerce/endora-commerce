import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * StockLevel — onHand + reserved counters per (productId, variantId?).
 * Unique per pair is enforced by a partial unique index in the migration.
 * `reserved` increments on order placement; it decrements on order cancellation
 * or on shipment (when onHand also decrements).
 */
@Entity({ tableName: 'stock_levels' })
export class StockLevel {
  [OptionalProps]?: 'id' | 'createdAt' | 'updatedAt' | 'variantId' | 'reserved';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  productId!: string;

  @Property({ type: 'uuid', nullable: true })
  variantId?: string | null;

  @Property({ type: 'integer' })
  onHand!: number;

  @Property({ type: 'integer' })
  reserved: number = 0;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
