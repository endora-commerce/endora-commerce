import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * Persistent record of one outbound e-mail decision (D-59, issue #114).
 *
 * Deliberately the `webhook_deliveries` shape rather than a new invention: same
 * problem (an outbound attempt whose outcome nothing survives), same position
 * (written after the attempt, by the seam that made it), same answer (one row
 * per attempt carrying the outcome, no queue, no `pending` state, no row that
 * exists before something was attempted). D-58 refused the transactional outbox
 * for the whole platform; D-59 keeps that refusal for invoice and KSeF document
 * mail and buys the visibility with this row instead.
 *
 * Global rather than org-scoped, for the same reason `webhook_deliveries` is:
 * the transport seam has no tenant — a boot-time send, a worker and an admin
 * request all reach it — and the row is a platform-operator audit trail, read
 * by the person answering "did this leave the building", not by a buyer.
 */
@GlobalEntity()
@Entity({ tableName: 'email_deliveries' })
export class EmailDelivery {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'attemptedAt'
    | 'reason'
    | 'detail'
    | 'subject'
    | 'salesChannelId'
    | 'documentType'
    | 'documentId'
    | 'context';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  /** The caller's idempotency key. Not unique: a resend is a second decision. */
  @Property({ type: 'string', length: 191 })
  @Index()
  messageId!: string;

  @Property({ type: 'string', length: 320 })
  @Index()
  recipient!: string;

  /** The transactional-email code, or a legacy in-code builder's own kind. */
  @Property({ type: 'string', length: 64 })
  @Index()
  kind!: string;

  /**
   * The three answers, and the split is the load-bearing part of this table.
   *
   * `suppressed` is the platform deliberately not sending — the operator
   * switched this e-mail off, or the transport already accepted this message
   * id. `failed` is a message that was meant to go out and did not: the
   * transport raised, none is wired, or no template exists for the code. Since
   * feature 074 shipped per-e-mail deactivation, fusing the two would tell an
   * operator that a configuration they chose is an outage.
   */
  @Property({ type: 'string', length: 16 })
  @Index()
  status!: 'sent' | 'suppressed' | 'failed';

  /** Which suppression or which failure, `null` for a delivered message. */
  @Property({ type: 'string', length: 64, nullable: true })
  reason?: string | null;

  /** Free text for the reason — a transport error message, typically. */
  @Property({ type: 'string', length: 4000, nullable: true })
  detail?: string | null;

  @Property({ type: 'string', length: 998, nullable: true })
  subject?: string | null;

  /** The channel the message was rendered for, `null` for platform-wide. */
  @Property({ type: 'uuid', nullable: true })
  salesChannelId?: string | null;

  /** The business document delivered, e.g. `invoice` — D-59's whole subject. */
  @Property({ type: 'string', length: 32, nullable: true })
  @Index()
  documentType?: string | null;

  @Property({ type: 'string', length: 64, nullable: true })
  @Index()
  documentId?: string | null;

  /** The sender's `meta` envelope, kept verbatim for the after-the-fact read. */
  @Property({ type: 'json', nullable: true })
  context?: Record<string, unknown> | null;

  @Property({ type: 'datetime' })
  @Index()
  attemptedAt: Date = new Date();

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
