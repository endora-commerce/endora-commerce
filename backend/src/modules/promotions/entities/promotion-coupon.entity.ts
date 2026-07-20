import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * Feature 045 — an individual coupon code gating a promotion. Either a
 * single specified code (`batchId` null) or one of a generated batch.
 */
@GlobalEntity()
@Entity({ tableName: 'promotion_coupons' })
export class PromotionCoupon {
  [OptionalProps]?: 'id' | 'createdAt' | 'batchId' | 'isActive';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  promotionId!: string;

  @Property({ type: 'uuid', nullable: true })
  @Index()
  batchId?: string | null;

  @Property({ type: 'string', length: 80 })
  @Unique()
  code!: string;

  /** `per_coupon` | `shared_batch` — denormalized from the batch. */
  @Property({ type: 'string', length: 16 })
  limitScope!: 'per_coupon' | 'shared_batch';

  @Property({ type: 'boolean', default: true })
  isActive: boolean = true;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
