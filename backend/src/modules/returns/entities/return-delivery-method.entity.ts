import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * ReturnDeliveryMethod — feature 046 (US6, FR-021).
 *
 * An allowed return delivery method with its return shipping cost (0 = free /
 * shop-paid). References an existing `delivery_methods.id` by value.
 */
@GlobalEntity()
@Entity({ tableName: 'return_delivery_methods' })
export class ReturnDeliveryMethod {
  [OptionalProps]?: 'id' | 'isActive' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  deliveryMethodId!: string;

  @Property({ type: 'decimal', precision: 14, scale: 2 })
  returnCost!: string;

  @Property({ type: 'string', length: 3 })
  currency!: string;

  @Property({ type: 'boolean' })
  isActive: boolean = true;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
