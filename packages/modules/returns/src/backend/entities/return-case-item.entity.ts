import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * ReturnCaseItem — feature 046.
 *
 * A returned/complained order line (full or partial quantity). `defaultRefundAmount`
 * is the amount paid for the returned quantity in the original order (incl.
 * proportional tax); `approvedRefundAmount` is the admin-adjustable settled value,
 * which MUST NOT exceed the default (FR-031/032).
 */
@GlobalEntity()
@Entity({ tableName: 'return_case_items' })
export class ReturnCaseItem {
  [OptionalProps]?:
    | 'id'
    | 'reasonId'
    | 'description'
    | 'inspectionOutcome'
    | 'approvedRefundAmount'
    | 'defaultDiscountAmount'
    | 'serialNumber';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  returnCaseId!: string;

  /** `null` on a line of a case without a platform order (180 FR-B12). */
  @Property({ type: 'uuid', nullable: true })
  @Index()
  orderItemId!: string | null;

  /** `null` for a free-text model (180 FR-B12). */
  @Property({ type: 'uuid', nullable: true })
  productId!: string | null;

  @Property({ type: 'string', length: 512 })
  productName!: string;

  @Property({ type: 'integer' })
  quantity!: number;

  @Property({ type: 'uuid', nullable: true })
  reasonId?: string | null;

  @Property({ type: 'text', nullable: true })
  description?: string | null;

  /** `pending` | `passed` | `failed`; set at Received. */
  @Property({ type: 'string', length: 16, nullable: true })
  inspectionOutcome?: 'pending' | 'passed' | 'failed' | null;

  @Property({ type: 'decimal', precision: 14, scale: 2 })
  defaultRefundAmount!: string;

  /**
   * Issue #417 — the part of the order-level discount the default refund
   * carries; a correction credits the goods at `refund + discount` and the
   * discount back on the invoice's discount line. `0` for a line recorded before.
   */
  @Property({ type: 'decimal', precision: 14, scale: 2, default: '0' })
  defaultDiscountAmount: string = '0';

  @Property({ type: 'decimal', precision: 14, scale: 2 })
  approvedRefundAmount: string = '0.00';

  /** 180 FR-B12 — the serial number the customer gave, on a complaint line. */
  @Property({ type: 'string', length: 100, nullable: true })
  serialNumber?: string | null;
}
