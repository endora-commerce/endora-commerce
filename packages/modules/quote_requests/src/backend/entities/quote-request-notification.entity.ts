import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { OrgScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';
import type {
  NotificationRecipientKind,
  QuoteRequestNotificationChange,
  QuoteRequestNotificationChannel,
} from '../services/notifications/notification-matrix.js';

/**
 * Where a delivery record stands. `pending` until one attempt closes it; every
 * other value is final. `skipped_<reason>` names why nothing was sent, so one
 * column answers the History screen and an operator's SQL (research R-7).
 */
export type QuoteRequestNotificationStatus =
  | 'pending'
  | 'sent'
  | 'skipped_stale'
  | 'skipped_module_off'
  | 'skipped_deactivated'
  | 'skipped_no_transport'
  | 'skipped_logged'
  | 'skipped_no_recipient'
  | 'skipped_preference'
  | 'skipped_no_subscription'
  | 'failed';

/**
 * QuoteRequestNotification — one delivery record per (source history entry,
 * recipient, channel), `specs/179-rfq-and-customer-notifications/` data-model §1.
 *
 * Written by `RfqNotificationService.record` in the transaction of the change
 * it announces, read by the delivery worker, and shown on the request's admin
 * History. The table's check constraints keep `status`, `channel` and
 * `recipient_kind` closed, a channel on its own side, and `closed_at` set
 * exactly when the record is no longer `pending`.
 *
 * `@OrgScoped()` with the request's Organization (Principle XI); the worker
 * reads it in the system scope with explicit predicates.
 *
 * `id` is also the idempotency key the channels are handed: the e-mail
 * `messageId` and the push `sourceEventId`.
 */
@OrgScoped()
@Entity({ tableName: 'quote_request_notifications' })
@Unique({
  name: 'quote_request_notifications_unique',
  properties: ['sourceEventId', 'recipientKind', 'recipientId', 'channel'],
})
@Index({ name: 'quote_request_notifications_request_idx', properties: ['quoteRequestId', 'sourceEventId'] })
export class QuoteRequestNotification {
  [OptionalProps]?: 'id' | 'status' | 'attempts' | 'nextAttemptAt' | 'lastError' | 'createdAt' | 'closedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  organizationId!: string;

  @Property({ type: 'uuid' })
  quoteRequestId!: string;

  /** The `quote_request_events` row this delivery announces. */
  @Property({ type: 'uuid' })
  sourceEventId!: string;

  @Property({ type: 'string', length: 32 })
  change!: QuoteRequestNotificationChange;

  @Property({ type: 'string', length: 16 })
  recipientKind!: NotificationRecipientKind;

  /** `admin_users.id` or `customer_accounts.id`, by `recipientKind`; no foreign key (other modules' tables). */
  @Property({ type: 'uuid' })
  recipientId!: string;

  @Property({ type: 'string', length: 24 })
  channel!: QuoteRequestNotificationChannel;

  @Property({ type: 'string', length: 32 })
  status: QuoteRequestNotificationStatus = 'pending';

  @Property({ type: 'integer' })
  attempts: number = 0;

  @Property({ type: 'datetime' })
  nextAttemptAt: Date = new Date();

  /** The last failure, at most 2000 characters; never a recipient address. */
  @Property({ type: 'text', nullable: true })
  lastError: string | null = null;

  /** The source history entry's `created_at`, copied so the 24-hour check needs no join. */
  @Property({ type: 'datetime' })
  sourceOccurredAt!: Date;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', nullable: true })
  closedAt: Date | null = null;
}
