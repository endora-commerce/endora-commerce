import { OptionalProps } from '@mikro-orm/core';
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * QuoteRequestEvent — append-only change log driving the storefront
 * and admin history block (FR-035 / FR-037).
 *
 * `payload` is a discriminated union shaped per data-model.md §4.1.
 * The DB schema does NOT enforce the union shape (jsonb); the service
 * layer must validate it at write time via Zod. The service-side
 * helper is in rfq-event-service.ts.
 */
export type QuoteRequestEventType =
  | 'created'
  | 'submitted'
  | 'modified'
  | 'approved'
  | 'canceled'
  | 'expired'
  | 'completed'
  | 'customer-accepted-revision'
  | 'customer-rejected-revision'
  | 're-submitted'
  | 'note-added'
  // Feature 153 (owner answer Q4) — the quote PDF was e-mailed. Admin-only:
  // the customer reply leaves it out.
  | 'pdf-sent'
  // Feature 162 — custom-field values a Sales Opportunity could not carry into
  // the request. Admin-only: it names keys of possibly internal fields.
  | 'custom-field-carry-skipped';

@GlobalEntity()
@Entity({ tableName: 'quote_request_events' })
export class QuoteRequestEvent {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'actorAdminUserId'
    | 'actorCustomerAccountId'
    | 'actorRoleLabel'
    | 'revisionId';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  quoteRequestId!: string;

  @Property({ type: 'string', length: 64 })
  eventType!: QuoteRequestEventType;

  @Property({ type: 'uuid', nullable: true })
  actorAdminUserId?: string | null;

  @Property({ type: 'uuid', nullable: true })
  actorCustomerAccountId?: string | null;

  @Property({ type: 'string', length: 64, nullable: true })
  actorRoleLabel?: string | null;

  @Property({ type: 'json' })
  payload!: Record<string, unknown>;

  @Property({ type: 'uuid', nullable: true })
  revisionId?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
