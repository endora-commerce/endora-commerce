import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import type { PromotionRule } from '@b2b/contracts';

/**
 * Feature 045 — a standalone, named promotion rule reusable across
 * promotions. Referenced by `promotions.rule_id`.
 */
@Entity({ tableName: 'promotion_rules' })
export class PromotionRuleEntity {
  [OptionalProps]?: 'id' | 'createdAt' | 'updatedAt' | 'description';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 160 })
  @Unique()
  name!: string;

  @Property({ type: 'text', nullable: true })
  description?: string | null;

  @Property({ type: 'json', columnType: 'jsonb' })
  definition!: PromotionRule;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  @Index()
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
