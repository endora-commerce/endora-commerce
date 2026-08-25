import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * Persistent record of an outbound webhook attempt — used by the admin panel's
 * delivery viewer + the dead-letter replay button. The transport layer
 * (BullMQ via webhook-delivery-worker) drives this row through state.
 *
 * `dispatchedAt` is set when the worker picks the job up; `lastResponse` and
 * `attemptCount` are bumped on every retry.
 */
@GlobalEntity()
@Entity({ tableName: 'webhook_deliveries' })
export class WebhookDelivery {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'attemptCount'
    | 'dispatchedAt'
    | 'lastResponseStatus'
    | 'lastResponseBody'
    | 'lastError'
    | 'completedAt'
    | 'deadLetteredAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  webhookId!: string;

  @Property({ type: 'string', length: 64 })
  @Index()
  eventId!: string;

  @Property({ type: 'string', length: 64 })
  @Index()
  eventType!: string;

  @Property({ type: 'json' })
  payload!: unknown;

  @Property({ type: 'string', length: 16 })
  @Index()
  status: 'pending' | 'in_flight' | 'succeeded' | 'failed' | 'dead_lettered' = 'pending';

  @Property({ type: 'integer' })
  attemptCount: number = 0;

  @Property({ type: 'datetime', nullable: true })
  dispatchedAt?: Date | null;

  @Property({ type: 'integer', nullable: true })
  lastResponseStatus?: number | null;

  @Property({ type: 'string', length: 4000, nullable: true })
  lastResponseBody?: string | null;

  @Property({ type: 'string', length: 4000, nullable: true })
  lastError?: string | null;

  @Property({ type: 'datetime', nullable: true })
  completedAt?: Date | null;

  @Property({ type: 'datetime', nullable: true })
  deadLetteredAt?: Date | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}

declare module 'fastify' {}
