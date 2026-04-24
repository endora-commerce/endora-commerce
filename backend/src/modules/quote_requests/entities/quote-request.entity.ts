import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * QuoteRequest (RFQ) — data-model.md § Domain 4.
 *
 * State transitions:
 *   draft → new (Customer submits)
 *   new → under_review (Admin claims)
 *   under_review → quoted (Admin sends quote; expiresAt set)
 *   quoted → accepted | rejected | expired
 *
 * `version` is bumped on every row mutation; `PATCH` handlers use it to enforce
 * optimistic concurrency via the `If-Match` header (contracts/quote_requests.contract.md).
 *
 * FK targets (customerAccountId, organizationId, assignedAdminUserId) are stored
 * as plain uuid columns without FK constraints — the target tables live in
 * US2/US3/US4. Referential integrity gets enabled by migrations shipped with
 * those stories.
 */
@Entity({ tableName: 'quote_requests' })
export class QuoteRequest {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'status'
    | 'requesterNote'
    | 'assignedAdminUserId'
    | 'submittedAt'
    | 'quotedAt'
    | 'respondedAt'
    | 'expiresAt'
    | 'quoteTerms'
    | 'version';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  organizationId!: string;

  @Property({ type: 'uuid' })
  @Index()
  customerAccountId!: string;

  @Property({ type: 'string', length: 32 })
  @Index()
  status: 'draft' | 'new' | 'under_review' | 'quoted' | 'accepted' | 'rejected' | 'expired' = 'draft';

  @Property({ type: 'text', nullable: true })
  requesterNote?: string | null;

  @Property({ type: 'uuid', nullable: true })
  assignedAdminUserId?: string | null;

  @Property({ type: 'datetime', nullable: true })
  submittedAt?: Date | null;

  @Property({ type: 'datetime', nullable: true })
  quotedAt?: Date | null;

  @Property({ type: 'datetime', nullable: true })
  respondedAt?: Date | null;

  @Property({ type: 'datetime', nullable: true })
  expiresAt?: Date | null;

  /**
   * Embedded quote terms populated on `quoted` — leadTimeDays, validityDays,
   * deliveryTerms, remarks. JSONB so the data-model.md "embedded" shape is
   * faithful without a sibling table.
   */
  @Property({ type: 'json', nullable: true })
  quoteTerms?: {
    leadTimeDays: number;
    validityDays: number;
    deliveryTerms?: string | null;
    remarks?: string | null;
  } | null;

  @Property({ type: 'integer' })
  version: number = 0;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
