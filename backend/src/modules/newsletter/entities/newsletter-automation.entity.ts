import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * NewsletterAutomation — feature 048. A linear send/wait sequence triggered by
 * all/tag/tag-list. `steps` is an ordered JSON list whose shape leaves room for
 * future branch/condition/tag-action node types (research R9).
 */
@Entity({ tableName: 'newsletter_automations' })
export class NewsletterAutomation {
  [OptionalProps]?:
    | 'status'
    | 'triggerTagIds'
    | 'salesChannelId'
    | 'reentryPolicy'
    | 'version'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 200 })
  name!: string;

  @Property({ type: 'string', length: 16 })
  status: 'draft' | 'active' | 'paused' = 'draft';

  @Property({ type: 'string', length: 16, fieldName: 'trigger_type' })
  triggerType: 'all' | 'tag' | 'tag_list' = 'all';

  @Property({ type: 'json', fieldName: 'trigger_tag_ids' })
  triggerTagIds: string[] = [];

  @Property({ type: 'uuid', fieldName: 'sales_channel_id', nullable: true })
  salesChannelId: string | null = null;

  @Property({ type: 'string', length: 12 })
  language!: string;

  @Property({ type: 'string', length: 16, fieldName: 'reentry_policy' })
  reentryPolicy: 'once' | 'every_trigger' = 'once';

  @Property({ type: 'json' })
  steps: Array<Record<string, unknown>> = [];

  @Property({ type: 'integer' })
  version: number = 1;

  @Property({ type: 'datetime', fieldName: 'created_at', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', fieldName: 'updated_at', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
