import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/** NewsletterEngagementEvent — feature 048. One open/click event per send record. */
@Entity({ tableName: 'newsletter_engagement_events' })
@Index({ properties: ['sendRecordId'] })
@Index({ properties: ['type'] })
export class NewsletterEngagementEvent {
  [OptionalProps]?: 'linkId' | 'url' | 'occurredAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'send_record_id' })
  sendRecordId!: string;

  @Property({ type: 'string', length: 8 })
  type!: 'open' | 'click';

  @Property({ type: 'string', length: 64, fieldName: 'link_id', nullable: true })
  linkId: string | null = null;

  @Property({ type: 'text', nullable: true })
  url: string | null = null;

  @Property({ type: 'datetime', fieldName: 'occurred_at', onCreate: () => new Date() })
  occurredAt: Date = new Date();
}
