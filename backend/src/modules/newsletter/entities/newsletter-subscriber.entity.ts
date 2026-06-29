import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * NewsletterSubscriber — feature 048. Identity is the email (global unique).
 * `status` drives mailability (only `active` + not suppressed is mailable).
 * `customFields` holds operator-defined values keyed by NewsletterCustomField.key.
 */
@Entity({ tableName: 'newsletter_subscribers' })
export class NewsletterSubscriber {
  [OptionalProps]?:
    | 'status'
    | 'source'
    | 'salesChannelId'
    | 'customerAccountId'
    | 'customFields'
    | 'consentAt'
    | 'confirmedAt'
    | 'unsubscribedAt'
    | 'unsubscribeReason'
    | 'deactivatedAt'
    | 'version'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 320 })
  @Unique()
  email!: string;

  @Property({ type: 'string', length: 16 })
  @Index()
  status: 'pending' | 'active' | 'unsubscribed' | 'deactivated' = 'pending';

  @Property({ type: 'string', length: 64, nullable: true })
  source: string | null = null;

  @Property({ type: 'uuid', fieldName: 'sales_channel_id', nullable: true })
  @Index()
  salesChannelId: string | null = null;

  @Property({ type: 'uuid', fieldName: 'customer_account_id', nullable: true })
  customerAccountId: string | null = null;

  @Property({ type: 'json', fieldName: 'custom_fields' })
  customFields: Record<string, string | number | boolean | null> = {};

  @Property({ type: 'datetime', fieldName: 'consent_at', nullable: true })
  consentAt: Date | null = null;

  @Property({ type: 'datetime', fieldName: 'confirmed_at', nullable: true })
  confirmedAt: Date | null = null;

  @Property({ type: 'datetime', fieldName: 'unsubscribed_at', nullable: true })
  unsubscribedAt: Date | null = null;

  @Property({ type: 'text', fieldName: 'unsubscribe_reason', nullable: true })
  unsubscribeReason: string | null = null;

  @Property({ type: 'datetime', fieldName: 'deactivated_at', nullable: true })
  deactivatedAt: Date | null = null;

  @Property({ type: 'integer' })
  version: number = 1;

  @Property({ type: 'datetime', fieldName: 'created_at', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', fieldName: 'updated_at', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
