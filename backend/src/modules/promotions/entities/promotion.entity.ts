import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import type { PromotionAction, PromotionCriterion, PromotionRule } from '@b2b/contracts';

/**
 * Promotion — a discount rule applied to a Cart snapshot (T129 / FR-052).
 *
 * Three kinds of effect:
 *   - `percentage_off`  — `value` 0..100, applied to either the cart subtotal
 *                          or the lines matching the optional category/product
 *                          scope.
 *   - `amount_off`      — `value` is money in `currency`.
 *   - `free_delivery`   — zero out the cart's delivery cost.
 *
 * Eligibility filters: `code`, `minCartSubtotal`, `validFrom`/`validUntil`,
 * `organizationId` / `customerGroupId`, `categoryId` / `productId`.
 *
 * Inactive (`isActive=false`) promotions are skipped without being deleted —
 * useful for re-enabling seasonally.
 */
@Entity({ tableName: 'promotions' })
export class Promotion {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'code'
    | 'currency'
    | 'minCartSubtotal'
    | 'validFrom'
    | 'validUntil'
    | 'organizationId'
    | 'customerGroupId'
    | 'categoryId'
    | 'productId'
    | 'criteria'
    | 'isActive'
    | 'description'
    | 'priority'
    | 'stopFurther'
    | 'actionType'
    | 'actionConfig'
    | 'ruleId'
    | 'ruleDefinition'
    | 'usageLimitGlobal'
    | 'usageLimitPerOrganization'
    | 'usageLimitPerCustomer';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 64, nullable: true })
  @Unique()
  code?: string | null;

  @Property({ type: 'string', length: 160 })
  name!: string;

  /** Legacy effect kind — nullable on feature-045 action-based promotions. */
  @Property({ type: 'string', length: 24, nullable: true })
  @Index()
  kind?: 'percentage_off' | 'amount_off' | 'free_delivery' | null;

  /** Legacy effect value — nullable on feature-045 action-based promotions. */
  @Property({ type: 'decimal', precision: 14, scale: 4, nullable: true })
  value?: string | null;

  @Property({ type: 'string', length: 3, nullable: true })
  currency?: string | null;

  @Property({ type: 'decimal', precision: 14, scale: 2, nullable: true })
  minCartSubtotal?: string | null;

  @Property({ type: 'datetime', nullable: true })
  validFrom?: Date | null;

  @Property({ type: 'datetime', nullable: true })
  validUntil?: Date | null;

  @Property({ type: 'uuid', nullable: true })
  @Index()
  organizationId?: string | null;

  @Property({ type: 'uuid', nullable: true })
  @Index()
  customerGroupId?: string | null;

  @Property({ type: 'uuid', nullable: true })
  categoryId?: string | null;

  @Property({ type: 'uuid', nullable: true })
  productId?: string | null;

  /**
   * Feature 012 / US8 — line-level discriminated criteria. ANDed with
   * the flat `categoryId` / `productId` scope. JSONB column with default
   * `'[]'::jsonb` so existing rows behave exactly as before until the
   * operator authors a criterion.
   */
  @Property({ type: 'json', columnType: 'jsonb', default: "'[]'" })
  criteria: PromotionCriterion[] = [];

  @Property({ type: 'boolean' })
  @Index()
  isActive: boolean = true;

  // --- Feature 045 — engine fields -----------------------------------------

  @Property({ type: 'text', nullable: true })
  description?: string | null;

  /** Application order across a cart's matching promotions (DESC). */
  @Property({ type: 'integer', default: 0 })
  @Index()
  priority: number = 0;

  /** When true, no lower-priority promotion applies once this one does. */
  @Property({ type: 'boolean', default: false })
  stopFurther: boolean = false;

  /** Registered action key (null on legacy kind/value promotions). */
  @Property({ type: 'string', length: 64, nullable: true })
  actionType?: PromotionAction['type'] | null;

  /** Action parameters, validated against the registered action's schema. */
  @Property({ type: 'json', columnType: 'jsonb', default: "'{}'" })
  actionConfig: Record<string, unknown> = {};

  /** Named-rule reference (mutually exclusive with `ruleDefinition`). */
  @Property({ type: 'uuid', nullable: true })
  @Index()
  ruleId?: string | null;

  /** Inline rule AST (mutually exclusive with `ruleId`). */
  @Property({ type: 'json', columnType: 'jsonb', nullable: true })
  ruleDefinition?: PromotionRule | null;

  @Property({ type: 'integer', nullable: true })
  usageLimitGlobal?: number | null;

  @Property({ type: 'integer', nullable: true })
  usageLimitPerOrganization?: number | null;

  @Property({ type: 'integer', nullable: true })
  usageLimitPerCustomer?: number | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
