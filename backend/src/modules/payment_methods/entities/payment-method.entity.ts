import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * PaymentMethod — kind discriminates the driver (bank_transfer, pickup,
 * credit_limit, gateway). Drivers ship with US2/US6/US7 depending on which
 * payment type they handle.
 */
@Entity({ tableName: 'payment_methods' })
export class PaymentMethod {
  [OptionalProps]?: 'id' | 'createdAt' | 'updatedAt' | 'status' | 'additionalPrice';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 64 })
  @Unique()
  code!: string;

  @Property({ type: 'json' })
  name!: Record<string, string>;

  @Property({ type: 'string', length: 32 })
  kind!: 'bank_transfer' | 'pickup' | 'credit_limit' | 'gateway';

  /**
   * Adapter registry key (feature 034). Determines which registered
   * PaymentAdapter realises the business logic. Backfilled from `kind`.
   */
  @Property({ type: 'string', length: 64 })
  adapter!: string;

  @Property({ type: 'string', length: 16 })
  status: 'active' | 'inactive' = 'active';

  /** Flat surcharge in the order currency added when this method is chosen. */
  @Property({ type: 'decimal', precision: 14, scale: 2 })
  additionalPrice: string = '0';

  /** Order-status references resolved through the OrderStatusRegistry port. */
  @Property({ type: 'string', length: 64 })
  statusOnPending!: string;

  @Property({ type: 'string', length: 64 })
  statusOnSuccess!: string;

  @Property({ type: 'string', length: 64 })
  statusOnFailure!: string;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
