import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/** NewsletterCampaign — feature 048. A one-off bulk send to a target audience. */
@GlobalEntity()
@Entity({ tableName: 'newsletter_campaigns' })
export class NewsletterCampaign {
  [OptionalProps]?:
    | 'salesChannelId'
    | 'targetTagIds'
    | 'trackingEnabled'
    | 'status'
    | 'scheduledAt'
    | 'dispatchJobId'
    | 'stats'
    | 'version'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 200 })
  name!: string;

  @Property({ type: 'text' })
  subject!: string;

  @Property({ type: 'json' })
  content: Record<string, unknown> = {};

  @Property({ type: 'uuid', fieldName: 'sales_channel_id', nullable: true })
  salesChannelId: string | null = null;

  @Property({ type: 'string', length: 12 })
  language!: string;

  @Property({ type: 'string', length: 16, fieldName: 'target_type' })
  targetType: 'all' | 'group' | 'tag' | 'tag_list' = 'all';

  @Property({ type: 'json', fieldName: 'target_tag_ids' })
  targetTagIds: string[] = [];

  @Property({ type: 'boolean', fieldName: 'tracking_enabled' })
  trackingEnabled: boolean = true;

  @Property({ type: 'string', length: 16 })
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled' = 'draft';

  @Property({ type: 'datetime', fieldName: 'scheduled_at', nullable: true })
  scheduledAt: Date | null = null;

  @Property({ type: 'string', length: 128, fieldName: 'dispatch_job_id', nullable: true })
  dispatchJobId: string | null = null;

  @Property({ type: 'json' })
  stats: Record<string, unknown> = {};

  @Property({ type: 'integer' })
  version: number = 1;

  @Property({ type: 'datetime', fieldName: 'created_at', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', fieldName: 'updated_at', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
