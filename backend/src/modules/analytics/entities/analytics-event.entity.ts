import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { OrgScoped } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * AnalyticsEvent (T237 / FR-110).
 *
 * Append-only event log. Storefront and admin POST batches into
 * `/api/v1/analytics/events`; the admin dashboard reads aggregated
 * counts from this table. The optional GA4 forwarder consumes the same
 * stream when the feature flag is on.
 *
 * Indexes:
 *   - `(occurred_at)`         — time-range queries dominate the dashboard
 *   - `(type, occurred_at)`   — per-type time series
 *   - `(sales_channel_id)`    — per-channel breakdowns
 */
@OrgScoped()
@Entity({ tableName: 'analytics_events' })
@Index({ name: 'idx_analytics_events_type_occurred_at', properties: ['type', 'occurredAt'] })
export class AnalyticsEvent {
  [OptionalProps]?:
    | 'id'
    | 'occurredAt'
    | 'recordedAt'
    | 'salesChannelId'
    | 'customerAccountId'
    | 'organizationId'
    | 'sessionId'
    | 'properties'
    | 'requestId';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 64 })
  type!: string;

  /** Storefront-supplied event timestamp; falls back to server `recordedAt`. */
  @Property({ type: 'datetime' })
  @Index()
  occurredAt: Date = new Date();

  @Property({ type: 'datetime', onCreate: () => new Date() })
  recordedAt: Date = new Date();

  @Property({ type: 'uuid', nullable: true })
  @Index()
  salesChannelId?: string | null;

  @Property({ type: 'uuid', nullable: true })
  customerAccountId?: string | null;

  @Property({ type: 'uuid', nullable: true })
  organizationId?: string | null;

  @Property({ type: 'string', length: 64, nullable: true })
  sessionId?: string | null;

  @Property({ type: 'json', nullable: true })
  properties?: Record<string, unknown> | null;

  /** Mirror of the X-Request-Id header for cross-log correlation. */
  @Property({ type: 'string', length: 64, nullable: true })
  requestId?: string | null;
}
