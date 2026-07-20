import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * QuoteRequestNotificationEvent — one row per recipient × channel ×
 * source event. The unique index on
 * (quote_request_id, source_event_id, recipient*, channel) enforces
 * once-only delivery (FR-030 + research §R4).
 */
export type QuoteRequestNotificationChannel = 'email' | 'in_app';
export type QuoteRequestNotificationStatus = 'queued' | 'sent' | 'failed';

@GlobalEntity()
@Entity({ tableName: 'quote_request_notification_events' })
export class QuoteRequestNotificationEvent {
  [OptionalProps]?:
    | 'id'
    | 'enqueuedAt'
    | 'sentAt'
    | 'error'
    | 'recipientAdminUserId'
    | 'recipientCustomerAccountId'
    | 'status';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  quoteRequestId!: string;

  @Property({ type: 'uuid' })
  sourceEventId!: string;

  @Property({ type: 'uuid', nullable: true })
  recipientAdminUserId?: string | null;

  @Property({ type: 'uuid', nullable: true })
  recipientCustomerAccountId?: string | null;

  @Property({ type: 'string', length: 16 })
  channel!: QuoteRequestNotificationChannel;

  @Property({ type: 'string', length: 16 })
  status: QuoteRequestNotificationStatus = 'queued';

  @Property({ type: 'text', nullable: true })
  error?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  enqueuedAt: Date = new Date();

  @Property({ type: 'datetime', nullable: true })
  sentAt?: Date | null;
}
