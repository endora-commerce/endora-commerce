import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

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
    | 'isActive';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 64, nullable: true })
  @Unique()
  code?: string | null;

  @Property({ type: 'string', length: 160 })
  name!: string;

  @Property({ type: 'string', length: 24 })
  @Index()
  kind!: 'percentage_off' | 'amount_off' | 'free_delivery';

  @Property({ type: 'decimal', precision: 14, scale: 4 })
  value!: string;

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

  @Property({ type: 'boolean' })
  @Index()
  isActive: boolean = true;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
