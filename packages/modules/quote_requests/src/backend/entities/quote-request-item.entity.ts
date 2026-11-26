import { OptionalProps } from '@mikro-orm/core';
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * QuoteRequestItem — a line on a Quote Request (feature 008).
 * Snapshots productName + productSlug so an archived product still
 * renders on a historical RFQ. `desiredUnitPrice` is the customer's
 * non-binding wish; the sales rep populates `agreedUnitPrice` on
 * approve / modify. `lineCurrency` snapshots the customer's price-list
 * currency at line creation time.
 */
@GlobalEntity()
@Entity({ tableName: 'quote_request_items' })
export class QuoteRequestItem {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'variantId'
    | 'variantLabel'
    | 'productSlug'
    | 'lineNote'
    | 'desiredUnitPrice'
    | 'agreedUnitPrice'
    | 'discountPercent'
    | 'packagingUnitName'
    | 'packagingUnitBaseQuantity'
    | 'packagingUnitId'
    | 'referenceUnitPrice'
    | 'referenceCurrency'
    | 'referenceCapturedAt'
    | 'groupId'
    | 'position';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  quoteRequestId!: string;

  @Property({ type: 'uuid' })
  productId!: string;

  @Property({ type: 'string', length: 255 })
  productName!: string;

  @Property({ type: 'string', length: 255, nullable: true })
  productSlug?: string | null;

  @Property({ type: 'uuid', nullable: true })
  variantId?: string | null;

  @Property({ type: 'string', length: 255, nullable: true })
  variantLabel?: string | null;

  @Property({ type: 'integer' })
  quantity!: number;

  /**
   * Feature 043 — set when the line was added as a packaging unit. The unit
   * name is also appended to `productName` so RFQ views show the suffix.
   */
  @Property({ type: 'string', length: 160, nullable: true })
  packagingUnitName?: string | null;

  @Property({ type: 'integer', nullable: true })
  packagingUnitBaseQuantity?: number | null;

  /**
   * Feature 155 (FR-026) — the catalogue packaging unit this line resolved
   * to, beside the name / base-quantity snapshot above. No foreign key:
   * units are hard-deleted and the snapshot outlives them.
   */
  @Property({ type: 'uuid', nullable: true })
  packagingUnitId?: string | null;

  @Property({ type: 'text', nullable: true })
  lineNote?: string | null;

  @Property({ type: 'decimal', precision: 14, scale: 4, nullable: true })
  desiredUnitPrice?: string | null;

  @Property({ type: 'decimal', precision: 14, scale: 4, nullable: true })
  agreedUnitPrice?: string | null;

  @Property({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  discountPercent?: string | null;

  @Property({ type: 'string', length: 3 })
  lineCurrency!: string;

  /**
   * Feature 146 (research R1) — the net unit price the request's owner would
   * have paid for this line on the request's channel when it was captured, or
   * the cart line's unit price on conversion. Always per base piece (the
   * line's quantity unit). The three reference columns are all-or-none (check
   * constraint `quote_request_items_reference_all_or_none`); all `null` means
   * no stored reference. Admin-only: never on the customer reply.
   */
  @Property({ type: 'decimal', precision: 14, scale: 4, nullable: true })
  referenceUnitPrice?: string | null;

  @Property({ type: 'string', length: 3, nullable: true })
  referenceCurrency?: string | null;

  @Property({ type: 'datetime', nullable: true })
  referenceCapturedAt?: Date | null;

  /**
   * Feature 159 — the line's group (`quote_request_item_groups`, same quote),
   * `null` = ungrouped. On delete set null (D2).
   */
  @Property({ type: 'uuid', nullable: true })
  groupId?: string | null = null;

  /**
   * Feature 159 — 0-based order within the line's section (its group, or the
   * ungrouped lines). Lines stored before the feature read `0`; readers break
   * ties by `(createdAt, id)` (research R-6).
   */
  @Property({ type: 'integer', default: 0 })
  position: number = 0;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
