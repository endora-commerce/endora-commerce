import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * Feature 045 — authoritative per-scope usage counter for atomic cap
 * enforcement (US5). Incremented inside the order-placement transaction via
 * `UPDATE ... WHERE count < limit` so the last available use is race-safe.
 */
@GlobalEntity()
@Entity({ tableName: 'promotion_usage_counters' })
@Unique({ properties: ['scopeType', 'scopeKey'] })
export class PromotionUsageCounter {
  [OptionalProps]?: 'id' | 'count';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  /** `global` | `organization` | `customer` | `coupon` | `batch`. */
  @Property({ type: 'string', length: 16 })
  scopeType!: 'global' | 'organization' | 'customer' | 'coupon' | 'batch';

  @Property({ type: 'string', length: 128 })
  scopeKey!: string;

  @Property({ type: 'integer', default: 0 })
  count: number = 0;
}
