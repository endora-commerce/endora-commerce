import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * Feature 045 — generator config for a batch of coupon codes (US4).
 */
@GlobalEntity()
@Entity({ tableName: 'coupon_batches' })
export class CouponBatch {
  [OptionalProps]?: 'id' | 'createdAt' | 'prefix' | 'suffix' | 'dashEvery';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  promotionId!: string;

  @Property({ type: 'integer' })
  count!: number;

  @Property({ type: 'integer' })
  length!: number;

  /** `alnum` | `digits` | `letters`. */
  @Property({ type: 'string', length: 16 })
  format!: 'alnum' | 'digits' | 'letters';

  @Property({ type: 'string', length: 32, nullable: true })
  prefix?: string | null;

  @Property({ type: 'string', length: 32, nullable: true })
  suffix?: string | null;

  /** Insert a dash every N characters; 0 = none. */
  @Property({ type: 'integer', default: 0 })
  dashEvery: number = 0;

  /** `per_coupon` | `shared_batch`. */
  @Property({ type: 'string', length: 16 })
  limitScope!: 'per_coupon' | 'shared_batch';

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
