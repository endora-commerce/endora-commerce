import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * BundleSlotOption — product the buyer can pick inside a BundleSlot
 * (feature 002 US5, data-model.md §2.9).
 *
 * DB-level guarantees (migration 023):
 *   - UNIQUE (slot_id, option_product_id) — same product can't appear twice in a slot
 *   - CHECK default_quantity > 0
 *
 * The "option product can't itself be grouped/bundle" rule is enforced
 * at the service layer (research R-8).
 */
@GlobalEntity()
@Entity({ tableName: 'bundle_slot_options' })
export class BundleSlotOption {
  [OptionalProps]?: 'id' | 'defaultQuantity' | 'position' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  slotId!: string;

  @Property({ type: 'uuid' })
  optionProductId!: string;

  @Property({ type: 'integer' })
  defaultQuantity: number = 1;

  @Property({ type: 'integer' })
  position: number = 0;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
