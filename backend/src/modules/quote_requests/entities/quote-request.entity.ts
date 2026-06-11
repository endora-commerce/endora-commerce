import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * QuoteRequest — feature 008 workflow rewrite.
 *
 * Statuses (replacing the foundation 001 set):
 *   Created from admin → Approved | Canceled | Expired
 *   Pending            → Approved | Canceled | Expired
 *   Approved           → Completed
 *   Canceled, Completed, Expired are terminal.
 *
 * `version` is bumped on every row mutation; PATCH-shaped endpoints
 * enforce optimistic concurrency via the `If-Match` header (foundation
 * 001 convention). Customer accept/reject revision additionally pin
 * `expectedRevisionNumber` against `current_revision_number`
 * (research §R3).
 */
export type QuoteRequestStatus =
  | 'Created from admin'
  | 'Pending'
  | 'Canceled'
  | 'Approved'
  | 'Completed'
  | 'Expired';

@Entity({ tableName: 'quote_requests' })
export class QuoteRequest {
  [OptionalProps]?:
    | 'id'
    | 'businessId'
    | 'createdAt'
    | 'updatedAt'
    | 'status'
    | 'headerNote'
    | 'createdByAdminUserId'
    | 'cancellationReason'
    | 'awaitingCustomerRevisionAcceptance'
    | 'lastCustomerSeenRevisionNumber'
    | 'currentRevisionNumber'
    | 'assignedAdminUserId'
    | 'submittedAt'
    | 'approvedAt'
    | 'canceledAt'
    | 'completedAt'
    | 'expiredAt'
    | 'expiresAt'
    | 'convertedOrderId'
    | 'version';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  /**
   * Customer-facing business Quote Request ID, distinct from `id`. Real RFQs
   * are stamped by RfqService / RfqAdminService via the business-ID sequence +
   * prefix/suffix settings. The placeholder default keeps direct
   * `em.create(QuoteRequest, …)` fixtures unique without forcing every caller
   * to pass it (mirrors `Order.businessId`).
   */
  @Property({ type: 'string', length: 128 })
  @Unique()
  businessId: string = `QR-${randomUUID()}`;

  @Property({ type: 'uuid' })
  @Index()
  organizationId!: string;

  @Property({ type: 'uuid' })
  @Index()
  customerAccountId!: string;

  @Property({ type: 'uuid', nullable: true })
  createdByAdminUserId?: string | null;

  @Property({ type: 'string', length: 32 })
  @Index()
  status: QuoteRequestStatus = 'Pending';

  @Property({ type: 'text', nullable: true, fieldName: 'header_note' })
  headerNote?: string | null;

  @Property({ type: 'text', nullable: true })
  cancellationReason?: string | null;

  @Property({ type: 'boolean' })
  awaitingCustomerRevisionAcceptance: boolean = false;

  @Property({ type: 'integer' })
  lastCustomerSeenRevisionNumber: number = 0;

  @Property({ type: 'integer' })
  currentRevisionNumber: number = 0;

  @Property({ type: 'uuid', nullable: true })
  assignedAdminUserId?: string | null;

  @Property({ type: 'datetime', nullable: true })
  submittedAt?: Date | null;

  @Property({ type: 'datetime', nullable: true })
  approvedAt?: Date | null;

  @Property({ type: 'datetime', nullable: true })
  canceledAt?: Date | null;

  @Property({ type: 'datetime', nullable: true })
  completedAt?: Date | null;

  @Property({ type: 'datetime', nullable: true })
  expiredAt?: Date | null;

  @Property({ type: 'datetime', nullable: true })
  expiresAt?: Date | null;

  @Property({ type: 'uuid', nullable: true })
  convertedOrderId?: string | null;

  @Property({ type: 'integer' })
  version: number = 0;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
