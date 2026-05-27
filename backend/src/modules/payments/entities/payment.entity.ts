import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

@Entity({ tableName: 'payments' })
export class Payment {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'status'
    | 'paidAt'
    | 'externalReference'
    | 'providerDetails'
    | 'failureReason'
    | 'attemptNo';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  orderId!: string;

  @Property({ type: 'uuid' })
  paymentMethodId!: string;

  @Property({ type: 'string', length: 32 })
  @Index()
  status: 'awaiting_payment' | 'paid' | 'failed' | 'deferred' | 'refunded' = 'awaiting_payment';

  @Property({ type: 'decimal', precision: 14, scale: 2 })
  amount!: string;

  @Property({ type: 'string', length: 3 })
  currency!: string;

  @Property({ type: 'datetime', nullable: true })
  paidAt?: Date | null;

  @Property({ type: 'string', length: 255, nullable: true })
  externalReference?: string | null;

  /** Adapter/PSP payload captured on receive_payment (feature 034). */
  @Property({ type: 'json', nullable: true })
  providerDetails?: Record<string, unknown> | null;

  /** Populated on a failure outcome. */
  @Property({ type: 'text', nullable: true })
  failureReason?: string | null;

  /** Retry sequence per order: 1 = first attempt. */
  @Property({ type: 'integer' })
  attemptNo: number = 1;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
