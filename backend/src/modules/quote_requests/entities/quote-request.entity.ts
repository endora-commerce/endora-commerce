import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { OrgScoped } from '../../../tenancy/org-scoped.decorator.js';
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

@OrgScoped()
@Entity({ tableName: 'quote_requests' })
export class QuoteRequest {
  [OptionalProps]?:
    | 'customFieldValues'
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
    | 'salesChannelId'
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

  /**
   * The sales channel this request was raised on — feature 005 / FR-012,
   * recorded since issue #266.
   *
   * The column, its index and its `on delete restrict` foreign key have existed
   * since `20260430T170044_core_sales_channels_promote`; the property that was
   * supposed to follow never landed, so nothing on the request path wrote it
   * and the FR-006 channel-delete guard has never seen an RFQ attribution.
   * Written from the **resolved request channel** (`currentSalesChannel()`),
   * never from a second lookup or a default of this module's choosing
   * (Principle XII).
   *
   * Held as a plain uuid FK target, exactly as `Order.salesChannelId` is,
   * rather than as an ORM relation: the schema's own foreign key is what keeps
   * the value honest.
   *
   * **Nullable, and it stays nullable.** Two shapes answer `null`: every row
   * raised before this property existed — the owner ruled those are developer
   * data not worth backfilling, and projecting them onto the system default
   * would invent an attribution the guard would then refuse on — and a request
   * created with no channel on the scope at all (a CLI, a worker, a fixture
   * that calls the service directly). "No channel" is spelled `null`, never an
   * empty string, a nil uuid or a fresh one (D-47…D-51).
   */
  @Property({ type: 'uuid', nullable: true })
  salesChannelId?: string | null;

  @Property({ type: 'integer' })
  version: number = 0;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();

  // Feature 055 — Custom Fields Layer value bag (inherits host tenant scope).
  @Property({ type: 'json' })
  customFieldValues: Record<string, unknown> = {};
}
