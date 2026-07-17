import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * NewsletterSendRecord — feature 048. Per-recipient send + the atomic
 * idempotency claim (Principle X). `id` is the stable provider messageId.
 * Unique (campaign_id, subscriber_id) / (automation_run_id, step_index,
 * subscriber_id) partial indexes are created in the migration.
 */
@GlobalEntity()
@Entity({ tableName: 'newsletter_send_records' })
@Index({ properties: ['subscriberId'] })
@Index({ properties: ['status'] })
export class NewsletterSendRecord {
  [OptionalProps]?:
    | 'campaignId'
    | 'automationRunId'
    | 'stepIndex'
    | 'status'
    | 'providerMessageId'
    | 'error'
    | 'openedAt'
    | 'clickCount'
    | 'sentAt'
    | 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'campaign_id', nullable: true })
  campaignId: string | null = null;

  @Property({ type: 'uuid', fieldName: 'automation_run_id', nullable: true })
  automationRunId: string | null = null;

  @Property({ type: 'integer', fieldName: 'step_index', nullable: true })
  stepIndex: number | null = null;

  @Property({ type: 'uuid', fieldName: 'subscriber_id' })
  subscriberId!: string;

  @Property({ type: 'string', length: 16 })
  status: 'queued' | 'sent' | 'failed' | 'bounced' | 'complained' = 'queued';

  @Property({ type: 'string', length: 255, fieldName: 'provider_message_id', nullable: true })
  providerMessageId: string | null = null;

  @Property({ type: 'text', nullable: true })
  error: string | null = null;

  @Property({ type: 'datetime', fieldName: 'opened_at', nullable: true })
  openedAt: Date | null = null;

  @Property({ type: 'integer', fieldName: 'click_count' })
  clickCount: number = 0;

  @Property({ type: 'datetime', fieldName: 'sent_at', nullable: true })
  sentAt: Date | null = null;

  @Property({ type: 'datetime', fieldName: 'created_at', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
