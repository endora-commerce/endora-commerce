import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * A line in a Cart. Two-layer pricing snapshot (feature 027):
 *   - `unitPrice` / `currency`: the price the line was added at. Read-only
 *     after add; useful for audit / diff and for the "added at" column in
 *     cart_audit_entries metadata.
 *   - `recomputedUnitPrice` / `recomputedAt` / `recomputedCurrency`: the
 *     most recent re-resolved price. The Cart-Pricing-Recompute helper
 *     refreshes these on every full-cart-view read (with a 30 s Redis
 *     cache between mini-cart / full-cart / checkout-entry walks).
 *     Cleared on any cart-side write.
 */
@Entity({ tableName: 'cart_items' })
export class CartItem {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'variantId'
    | 'recomputedUnitPrice'
    | 'recomputedAt'
    | 'recomputedCurrency'
    | 'packagingUnitId'
    | 'packagingUnitName'
    | 'packagingUnitBaseQuantity';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  cartId!: string;

  @Property({ type: 'uuid' })
  productId!: string;

  @Property({ type: 'uuid', nullable: true })
  variantId?: string | null;

  @Property({ type: 'integer' })
  quantity!: number;

  /** Price snapshot at time of add — services recalculate on read. */
  @Property({ type: 'decimal', precision: 12, scale: 2 })
  unitPrice!: string;

  @Property({ type: 'string', length: 3 })
  currency!: string;

  /**
   * Most-recent re-resolved unit price (per feature 011 PricingService).
   * Stale beyond the cache TTL → re-resolve on next read. Cleared on every
   * cart-side write so the next read forces a fresh resolution.
   */
  @Property({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  recomputedUnitPrice?: string | null;

  @Property({ type: 'datetime', nullable: true })
  recomputedAt?: Date | null;

  @Property({ type: 'string', length: 3, nullable: true })
  recomputedCurrency?: string | null;

  /**
   * Feature 043 — when this line was added as a packaging unit (e.g. a
   * pallet), these snapshot the unit it came from. `quantity` above already
   * holds the resulting base-piece count. Null for plain single-piece lines.
   */
  @Property({ type: 'uuid', nullable: true })
  packagingUnitId?: string | null;

  @Property({ type: 'string', length: 160, nullable: true })
  packagingUnitName?: string | null;

  @Property({ type: 'integer', nullable: true })
  packagingUnitBaseQuantity?: number | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
