import { Entity, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * PaymentMethod — kind discriminates the driver (bank_transfer, pickup,
 * credit_limit, gateway). Drivers ship with US2/US6/US7 depending on which
 * payment type they handle.
 */
@Entity({ tableName: 'payment_methods' })
export class PaymentMethod {
  [OptionalProps]?: 'id' | 'createdAt' | 'updatedAt' | 'status';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 64 })
  @Unique()
  code!: string;

  @Property({ type: 'json' })
  name!: Record<string, string>;

  @Property({ type: 'string', length: 32 })
  kind!: 'bank_transfer' | 'pickup' | 'credit_limit' | 'gateway';

  @Property({ type: 'string', length: 16 })
  status: 'active' | 'inactive' = 'active';

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
