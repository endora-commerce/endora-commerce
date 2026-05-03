import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
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
  | 'note-added';

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
