import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * PushSubscription (feature 046, US4). One subscribed storefront device/browser —
 * a standard Web-Push subscription (endpoint + p256dh + auth). Idempotent on
 * `endpoint` (upsert on re-subscribe). `customerAccountId` is null for anonymous
 * devices (FR-023). Constraints/indexes are declared in migration 080.
 */
@Entity({ tableName: 'push_subscriptions' })
@Unique({ properties: ['endpoint'] })
export class PushSubscription {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'lastSeenAt'
    | 'status'
    | 'provider'
    | 'customerAccountId'
    | 'userAgent';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  salesChannelId!: string;

  @Property({ type: 'uuid', nullable: true })
  @Index()
  customerAccountId?: string | null;

  @Property({ type: 'text' })
  endpoint!: string;

  @Property({ type: 'text' })
  p256dh!: string;

  @Property({ type: 'text' })
  auth!: string;

  @Property({ type: 'string', length: 32 })
  provider: string = 'web_push';

  @Property({ type: 'string', length: 16 })
  status: 'active' | 'invalid' = 'active';

  @Property({ type: 'text', nullable: true })
  userAgent?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime' })
  lastSeenAt: Date = new Date();
}
