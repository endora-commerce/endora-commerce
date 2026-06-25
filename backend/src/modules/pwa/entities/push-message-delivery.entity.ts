import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * PushMessageDelivery (feature 046, US4). One row per (message × subscription) —
 * the unit the BullMQ worker processes. `(messageId, subscriptionId)` is unique,
 * providing delivery idempotency across retries (Principle X).
 */
@Entity({ tableName: 'push_message_deliveries' })
@Unique({ properties: ['messageId', 'subscriptionId'] })
export class PushMessageDelivery {
  [OptionalProps]?: 'id' | 'createdAt' | 'attemptedAt' | 'status' | 'attempts' | 'lastError';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  messageId!: string;

  @Property({ type: 'uuid' })
  subscriptionId!: string;

  @Property({ type: 'string', length: 16 })
  @Index()
  status: 'pending' | 'sent' | 'failed' | 'pruned' = 'pending';

  @Property({ type: 'integer' })
  attempts: number = 0;

  @Property({ type: 'text', nullable: true })
  lastError?: string | null;

  @Property({ type: 'datetime', nullable: true })
  attemptedAt?: Date | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
