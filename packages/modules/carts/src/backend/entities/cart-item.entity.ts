import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * A line in a Cart. Two-layer pricing snapshot (feature 027):
 *   - `unitPrice` / `currency`: the price the line is ordered at — the price
 *     for its **current** quantity. Re-resolved whenever the quantity changes
 *     (add-merge, quantity update, login merge), and compared with a fresh
 *     resolution at order placement, which refuses a line whose stored price
 *     is no longer current.
 *   - `recomputedUnitPrice` / `recomputedAt` / `recomputedCurrency`: the
 *     most recent re-resolved price. The Cart-Pricing-Recompute helper
 *     refreshes these on every full-cart-view read (with a 30 s Redis
 *     cache between mini-cart / full-cart / checkout-entry walks).
 *     Cleared on any cart-side write.
 */
@GlobalEntity()
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
    | 'packagingUnitBaseQuantity'
    | 'agreedQuantity'
    | 'agreedUnitPrice'
    | 'agreedCurrency'
    | 'priceSource';

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

  /** The unit price the line is ordered at, for its current quantity. */
  @Property({ type: 'decimal', precision: 12, scale: 2 })
  unitPrice!: string;

  @Property({ type: 'string', length: 3 })
  currency!: string;

  /**
   * Feature 160 (D-287 P1, FR-030) — which tier priced `unitPrice` (`base`,
   * `catalogue`, `buyer`, `sale`), or `agreed` for a quote's agreed price.
   * Written with `unitPrice`; `null` on a line priced before the feature.
   */
  @Property({ type: 'string', length: 16, nullable: true })
  priceSource?: 'agreed' | 'base' | 'catalogue' | 'buyer' | 'sale' | null = null;

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

  /**
   * The agreement a line seeded from an accepted Quote Request carries: the
   * seller's unit price and the quantity it was agreed for. The line is
   * ordered at `agreedUnitPrice` only while `quantity` equals
   * `agreedQuantity`; at any other quantity it is priced like any other line,
   * and returning to the agreed quantity restores the agreed price. All three
   * are null on every other line.
   *
   * Feature 155 (FR-028) reads `agreedQuantity` too: while `quantity` equals
   * it and the basket still carries its quote source, the line is exempt from
   * the catalogue's order minimums (`isQuoteSeededLineExempt`).
   */
  @Property({ type: 'integer', nullable: true })
  agreedQuantity?: number | null;

  @Property({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  agreedUnitPrice?: string | null;

  @Property({ type: 'string', length: 3, nullable: true })
  agreedCurrency?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
