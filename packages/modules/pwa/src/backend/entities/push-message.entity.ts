import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';
import type { PushAudience, PushTrigger, PushMessageStatus } from '@endora-commerce/contracts';

/**
 * PushMessage (feature 046, US4). A notification to be delivered, admin-initiated
 * or event-triggered. `(trigger, sourceEventId)` is unique when sourceEventId is
 * present, so a business event cannot produce duplicate messages (FR-024).
 */
@GlobalEntity()
@Entity({ tableName: 'push_messages' })
export class PushMessage {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'sentAt'
    | 'status'
    | 'sentCount'
    | 'failedCount'
    | 'iconUrl'
    | 'url'
    | 'sourceEventId'
    | 'createdByAdminUserId';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  salesChannelId!: string;

  @Property({ type: 'string', length: 120 })
  title!: string;

  @Property({ type: 'string', length: 500 })
  body!: string;

  @Property({ type: 'text', nullable: true })
  iconUrl?: string | null;

  @Property({ type: 'text', nullable: true })
  url?: string | null;

  @Property({ type: 'json' })
  audience!: PushAudience;

  @Property({ type: 'string', length: 32 })
  trigger!: PushTrigger;

  @Property({ type: 'string', length: 128, nullable: true })
  sourceEventId?: string | null;

  @Property({ type: 'string', length: 16 })
  status: PushMessageStatus = 'queued';

  @Property({ type: 'integer' })
  sentCount: number = 0;

  @Property({ type: 'integer' })
  failedCount: number = 0;

  @Property({ type: 'uuid', nullable: true })
  createdByAdminUserId?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', nullable: true })
  sentAt?: Date | null;
}
