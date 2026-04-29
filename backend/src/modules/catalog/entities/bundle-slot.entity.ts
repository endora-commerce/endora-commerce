import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * BundleSlot — named slot inside a bundle product (feature 002 US5,
 * data-model.md §2.9). Each slot has a min/max quantity range and one
 * or more `BundleSlotOption` rows that the buyer chooses between.
 *
 * `name` is multilingual jsonb so storefront localization works without
 * a separate translation table (foundation pattern, same as Product).
 *
 * DB-level guarantees (migration 023):
 *   - CHECK min_quantity <= max_quantity
 *   - CHECK min_quantity >= 0, max_quantity > 0
 */
@Entity({ tableName: 'bundle_slots' })
export class BundleSlot {
  [OptionalProps]?: 'id' | 'minQuantity' | 'position' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  parentProductId!: string;

  @Property({ type: 'json' })
  name!: Record<string, string>;

  @Property({ type: 'integer' })
  minQuantity: number = 0;

  @Property({ type: 'integer' })
  maxQuantity!: number;

  @Property({ type: 'integer' })
  position: number = 0;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
