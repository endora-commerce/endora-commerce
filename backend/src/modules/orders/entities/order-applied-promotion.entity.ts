import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * Feature 045 / US2 — per-promotion discount breakdown carried from the cart
 * onto the placed order. The aggregate stays on `orders.discount_total`.
 */
@GlobalEntity()
@Entity({ tableName: 'order_applied_promotions' })
export class OrderAppliedPromotion {
  [OptionalProps]?: 'id' | 'couponId';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  orderId!: string;

  @Property({ type: 'uuid' })
  promotionId!: string;

  @Property({ type: 'uuid', nullable: true })
  couponId?: string | null;

  @Property({ type: 'decimal', precision: 14, scale: 2 })
  amount!: string;

  @Property({ type: 'string', length: 3 })
  currency!: string;
}
