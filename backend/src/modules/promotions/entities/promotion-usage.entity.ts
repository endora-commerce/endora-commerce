import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * Feature 045 — a finalized redemption of a promotion/coupon, written on
 * order placement (US5). Denormalized dimensions feed the statistics
 * aggregates (US7).
 */
@Entity({ tableName: 'promotion_usages' })
@Unique({ properties: ['orderId', 'promotionId'] })
export class PromotionUsage {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'couponId'
    | 'customerAccountId'
    | 'organizationId'
    | 'customerGroupId';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  promotionId!: string;

  @Property({ type: 'uuid', nullable: true })
  @Index()
  couponId?: string | null;

  @Property({ type: 'uuid' })
  orderId!: string;

  @Property({ type: 'uuid', nullable: true })
  @Index()
  customerAccountId?: string | null;

  @Property({ type: 'uuid', nullable: true })
  @Index()
  organizationId?: string | null;

  @Property({ type: 'uuid', nullable: true })
  @Index()
  customerGroupId?: string | null;

  @Property({ type: 'uuid' })
  @Index()
  salesChannelId!: string;

  @Property({ type: 'decimal', precision: 14, scale: 2 })
  discountAmount!: string;

  @Property({ type: 'string', length: 3 })
  currency!: string;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  @Index()
  createdAt: Date = new Date();
}
