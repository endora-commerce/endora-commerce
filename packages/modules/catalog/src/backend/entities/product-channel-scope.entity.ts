import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import type { ProductScopeStatus, ProductVisibility } from '@endora-commerce/contracts';

/**
 * ProductChannelScope — feature 163 (`specs/163-product-data-scopes/`
 * data-model.md §1, research R1).
 *
 * One row per (product, sales channel) holding the channel overrides of the
 * channel-scoped scalar fields (FR-009). Every `null` inherits the product's
 * global value; the window inherits as a pair through `windowOverridden`, so an
 * overridden window may be open on both sides while the global one is bounded
 * (R4); the audience inherits as a pair too — `visibility` and
 * `allowedOrganizationIds` are both set or both `null` (C4).
 *
 * A row whose every field inherits is deleted by the write service rather than
 * stored (FR-012). A row of a channel the product has left stays and is ignored
 * (FR-015). Platform-global like `products` (FR-083): the audience is evaluated at
 * read time against the buyer's organization.
 */
@GlobalEntity()
@Entity({ tableName: 'product_channel_scopes' })
export class ProductChannelScope {
  [OptionalProps]?:
    | 'status'
    | 'windowOverridden'
    | 'publishFrom'
    | 'publishUntil'
    | 'visibility'
    | 'allowedOrganizationIds'
    | 'minOrderQuantityOverridden'
    | 'minOrderQuantity'
    | 'returnable'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  productId!: string;

  @PrimaryKey({ type: 'uuid', fieldName: 'sales_channel_id' })
  salesChannelId!: string;

  /** FR-010 — `null` = inherit; `inactive` here is plain off, never an archive. */
  @Property({ type: 'string', length: 16, nullable: true })
  status?: ProductScopeStatus | null;

  /** R4 — the pair below replaces the global window when `true`. */
  @Property({ type: 'boolean' })
  windowOverridden: boolean = false;

  /** FR-023 — inclusive; meaningful only when `windowOverridden`. */
  @Property({ type: 'datetime', nullable: true })
  publishFrom?: Date | null;

  /** FR-023 — inclusive; meaningful only when `windowOverridden`. */
  @Property({ type: 'datetime', nullable: true })
  publishUntil?: Date | null;

  /** FR-030 — `null` = inherit the whole global audience rule. */
  @Property({ type: 'string', length: 32, nullable: true })
  visibility?: ProductVisibility | null;

  /** FR-030 — set exactly when `visibility` is; may name organizations that are not channel members (C4). */
  @Property({ type: 'json', nullable: true })
  allowedOrganizationIds?: string[] | null;

  /**
   * Feature 168 (data-model §4) — whether this channel overrides the Global minimum order
   * quantity. CHECK `min_order_quantity_overridden or min_order_quantity is null`.
   */
  @Property({ type: 'boolean' })
  minOrderQuantityOverridden: boolean = false;

  /** Meaningful only when overridden: 1…1 000 000, or `null` = no minimum in this channel. */
  @Property({ type: 'integer', nullable: true })
  minOrderQuantity?: number | null;

  /** FR-100 — `null` = inherit. */
  @Property({ type: 'boolean', nullable: true })
  returnable?: boolean | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
