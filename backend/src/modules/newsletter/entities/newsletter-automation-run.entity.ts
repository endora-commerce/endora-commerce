import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * NewsletterAutomationRun — feature 048. One subscriber's journey through an
 * automation. A partial unique (automation_id, subscriber_id) where status <>
 * 'cancelled' enforces the `once` re-entry policy (created in the migration).
 */
@GlobalEntity()
@Entity({ tableName: 'newsletter_automation_runs' })
@Index({ properties: ['automationId'] })
export class NewsletterAutomationRun {
  [OptionalProps]?:
    | 'currentStep'
    | 'status'
    | 'nextStepAt'
    | 'nextStepJobId'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid', fieldName: 'automation_id' })
  automationId!: string;

  @Property({ type: 'uuid', fieldName: 'subscriber_id' })
  subscriberId!: string;

  @Property({ type: 'integer', fieldName: 'current_step' })
  currentStep: number = 0;

  @Property({ type: 'string', length: 16 })
  status: 'active' | 'completed' | 'cancelled' = 'active';

  @Property({ type: 'datetime', fieldName: 'next_step_at', nullable: true })
  nextStepAt: Date | null = null;

  @Property({ type: 'string', length: 128, fieldName: 'next_step_job_id', nullable: true })
  nextStepJobId: string | null = null;

  @Property({ type: 'datetime', fieldName: 'created_at', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', fieldName: 'updated_at', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
