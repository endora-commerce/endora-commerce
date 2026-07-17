import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * NewsletterSuppression — feature 048. Email-keyed exclusion list that
 * survives subscriber deletion and overrides all targeting.
 */
@GlobalEntity()
@Entity({ tableName: 'newsletter_suppressions' })
export class NewsletterSuppression {
  [OptionalProps]?: 'detail' | 'createdAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 320 })
  @Unique()
  email!: string;

  @Property({ type: 'string', length: 16 })
  reason!: 'unsubscribe' | 'bounce' | 'complaint';

  @Property({ type: 'text', nullable: true })
  detail: string | null = null;

  @Property({ type: 'datetime', fieldName: 'created_at', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
