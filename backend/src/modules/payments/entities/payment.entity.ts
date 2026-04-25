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
    | 'externalReference';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  orderId!: string;

  @Property({ type: 'uuid' })
  paymentMethodId!: string;

  @Property({ type: 'string', length: 32 })
  @Index()
  status: 'awaiting_payment' | 'paid' | 'deferred' | 'refunded' = 'awaiting_payment';

  @Property({ type: 'decimal', precision: 14, scale: 2 })
  amount!: string;

  @Property({ type: 'string', length: 3 })
  currency!: string;

  @Property({ type: 'datetime', nullable: true })
  paidAt?: Date | null;

  @Property({ type: 'string', length: 255, nullable: true })
  externalReference?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
