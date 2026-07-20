import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
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
    | 'approvedRefundAmount';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  returnCaseId!: string;

  @Property({ type: 'uuid' })
  @Index()
  orderItemId!: string;

  @Property({ type: 'uuid' })
  productId!: string;

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

  @Property({ type: 'decimal', precision: 14, scale: 2 })
  approvedRefundAmount: string = '0.00';
}
