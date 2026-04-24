import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * QuoteRequestItem — a line on a RFQ. Snapshots productName so an archived
 * product still renders on a historical RFQ (data-model.md cross-cutting
 * section). Pricing fields populate when the RFQ transitions to `quoted`.
 */
@Entity({ tableName: 'quote_request_items' })
export class QuoteRequestItem {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'variantId'
    | 'variantLabel'
    | 'requesterNote'
    | 'quotedUnitPrice'
    | 'quotedDiscountPercent';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  quoteRequestId!: string;

  @Property({ type: 'uuid' })
  productId!: string;

  @Property({ type: 'string', length: 255 })
  productName!: string;

  @Property({ type: 'uuid', nullable: true })
  variantId?: string | null;

  @Property({ type: 'string', length: 255, nullable: true })
  variantLabel?: string | null;

  @Property({ type: 'integer' })
  quantity!: number;

  @Property({ type: 'text', nullable: true })
  requesterNote?: string | null;

  @Property({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  quotedUnitPrice?: string | null;

  @Property({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  quotedDiscountPercent?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
