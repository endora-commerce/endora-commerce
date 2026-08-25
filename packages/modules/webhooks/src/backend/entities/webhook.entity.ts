import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * Outbound webhook subscription (FR-121).
 *
 *   - `eventTypes` array gates which events trigger a delivery for this row.
 *   - `secret` is shared with the receiver so they can verify the HMAC the
 *     delivery worker stamps on every POST body.
 *   - `status='paused'` stops new deliveries without deleting historical
 *     WebhookDelivery rows.
 */
@GlobalEntity()
@Entity({ tableName: 'webhooks' })
export class Webhook {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'status'
    | 'eventTypes'
    | 'createdByAdminUserId'
    | 'organizationId';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 160 })
  name!: string;

  @Property({ type: 'string', length: 2048 })
  url!: string;

  /** Shared secret, stored plaintext (already at rest in the DB; the HMAC is
   *  what protects payload integrity in transit). 64 hex chars by default. */
  @Property({ type: 'string', length: 128 })
  secret!: string;

  @Property({ type: 'json' })
  eventTypes: string[] = [];

  @Property({ type: 'string', length: 16 })
  @Index()
  status: 'active' | 'paused' = 'active';

  @Property({ type: 'uuid', nullable: true })
  createdByAdminUserId?: string | null;

  /**
   * Feature 062 — delivery filter (data-model.md §3). NULL = platform-wide
   * subscription (legacy semantics); a value restricts delivery to events
   * whose payload `organizationId` matches. Evaluated in the event-bridge
   * lookup; the row itself stays `@GlobalEntity()` (admin-managed platform
   * configuration — research §R12).
   */
  @Property({ type: 'uuid', nullable: true })
  @Index()
  organizationId?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
