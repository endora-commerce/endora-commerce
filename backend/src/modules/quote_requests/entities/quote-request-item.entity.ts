import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * QuoteRequestItem — a line on a Quote Request (feature 008).
 * Snapshots productName + productSlug so an archived product still
 * renders on a historical RFQ. `desiredUnitPrice` is the customer's
 * non-binding wish; the sales rep populates `agreedUnitPrice` on
 * approve / modify. `lineCurrency` snapshots the customer's price-list
 * currency at line creation time.
 */
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
    | 'discountPercent';

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

  @Property({ type: 'text', nullable: true })
  lineNote?: string | null;

  @Property({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  desiredUnitPrice?: string | null;

  @Property({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  agreedUnitPrice?: string | null;

  @Property({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  discountPercent?: string | null;

  @Property({ type: 'string', length: 3 })
  lineCurrency!: string;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
