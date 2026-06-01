import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * CustomerAddress — a delivery or billing address in a Customer's personal
 * address book (feature 040, US2 / FR-008/FR-038). Works for both org-bound
 * and standalone customers. The partial unique index
 * "one default per (customer, kind)" is enforced in the migration, mirroring
 * the org-level `addresses` table.
 */
@Entity({ tableName: 'customer_addresses' })
export class CustomerAddress {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'isDefault'
    | 'phone'
    | 'deletedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  customerAccountId!: string;

  @Property({ type: 'string', length: 16 })
  @Index()
  kind!: 'delivery' | 'billing';

  @Property({ type: 'string', length: 160 })
  recipientName!: string;

  @Property({ type: 'string', length: 255 })
  street!: string;

  @Property({ type: 'string', length: 120 })
  city!: string;

  @Property({ type: 'string', length: 20 })
  postalCode!: string;

  @Property({ type: 'string', length: 2 })
  country!: string;

  @Property({ type: 'string', length: 32, nullable: true })
  phone?: string | null;

  @Property({ type: 'boolean' })
  isDefault: boolean = false;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();

  @Property({ type: 'datetime', nullable: true })
  deletedAt?: Date | null;
}
