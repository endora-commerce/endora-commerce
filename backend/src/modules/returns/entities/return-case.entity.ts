import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';
import { OrgScoped } from '../../../tenancy/org-scoped.decorator.js';

/**
 * ReturnCase — feature 046 (RMA case).
 *
 * One per customer return/complaint submission against an order. `kind`
 * distinguishes a withdrawal-style Return from a warranty Complaint (the
 * free-return window applies only to `return`). `rmaNumber` is assigned on
 * authorization (`${prefix}${seq}${suffix}`) and unique; `statusCode` references
 * `return_statuses.code` and is governed by the configurable workflow.
 */
@OrgScoped()
@Entity({ tableName: 'return_cases' })
export class ReturnCase {
  [OptionalProps]?:
    | 'id'
    | 'rmaNumber'
    | 'organizationId'
    | 'returnDeliveryMethodId'
    | 'appliedReturnCost'
    | 'returnCostBearer'
    | 'freeReturnEligible'
    | 'resolutionType'
    | 'refundPaymentMethodId'
    | 'totalRefundAmount'
    | 'rejectionReason'
    | 'authorizedAt'
    | 'resolvedAt'
    | 'closedAt'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  /** `return` (withdrawal) or `complaint` (defect/warranty). */
  @Property({ type: 'string', length: 16 })
  kind!: 'return' | 'complaint';

  /** Assigned on authorization; null until then. */
  @Property({ type: 'string', length: 64, nullable: true })
  @Unique()
  rmaNumber?: string | null;

  @Property({ type: 'uuid' })
  @Index()
  orderId!: string;

  @Property({ type: 'uuid' })
  @Index()
  salesChannelId!: string;

  @Property({ type: 'uuid' })
  @Index()
  customerAccountId!: string;

  @Property({ type: 'uuid', nullable: true })
  @Index()
  organizationId?: string | null;

  @Property({ type: 'string', length: 64 })
  @Index()
  statusCode!: string;

  @Property({ type: 'string', length: 3 })
  currency!: string;

  @Property({ type: 'uuid', nullable: true })
  returnDeliveryMethodId?: string | null;

  @Property({ type: 'decimal', precision: 14, scale: 2 })
  appliedReturnCost: string = '0.00';

  /** Who bears the return shipping cost: `shop` or `customer`. */
  @Property({ type: 'string', length: 16 })
  returnCostBearer: 'shop' | 'customer' = 'customer';

  @Property({ type: 'boolean' })
  freeReturnEligible: boolean = false;

  /** `refund` | `credit` | `replacement` | `repair`; null until settlement. */
  @Property({ type: 'string', length: 16, nullable: true })
  resolutionType?: 'refund' | 'credit' | 'replacement' | 'repair' | null;

  @Property({ type: 'uuid', nullable: true })
  refundPaymentMethodId?: string | null;

  @Property({ type: 'decimal', precision: 14, scale: 2 })
  totalRefundAmount: string = '0.00';

  @Property({ type: 'text', nullable: true })
  rejectionReason?: string | null;

  @Property({ type: 'datetime' })
  submittedAt!: Date;

  @Property({ type: 'datetime', nullable: true })
  authorizedAt?: Date | null;

  @Property({ type: 'datetime', nullable: true })
  resolvedAt?: Date | null;

  @Property({ type: 'datetime', nullable: true })
  closedAt?: Date | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
