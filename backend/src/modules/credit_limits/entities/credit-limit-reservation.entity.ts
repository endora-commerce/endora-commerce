import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * One row per Order placed against a credit-limit payment method. Active until
 * the order is paid (releasedReason='invoice_paid') or cancelled
 * (releasedReason='order_cancelled') — both transitions flip status to
 * 'released' and the available amount on the parent CreditLimit grows back.
 */
@Entity({ tableName: 'credit_limit_reservations' })
export class CreditLimitReservation {
  [OptionalProps]?: 'id' | 'createdAt' | 'updatedAt' | 'releasedAt' | 'releasedReason' | 'status';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  creditLimitId!: string;

  @Property({ type: 'uuid' })
  @Index()
  orderId!: string;

  @Property({ type: 'decimal', precision: 14, scale: 2 })
  amount!: string;

  @Property({ type: 'string', length: 3 })
  currency!: string;

  @Property({ type: 'string', length: 16 })
  @Index()
  status: 'active' | 'released' = 'active';

  @Property({ type: 'datetime', nullable: true })
  releasedAt?: Date | null;

  @Property({ type: 'string', length: 32, nullable: true })
  releasedReason?: 'invoice_paid' | 'order_cancelled' | 'admin_revocation' | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
