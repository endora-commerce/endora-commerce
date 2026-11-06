import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { CustomerScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * CustomerAddress — a delivery or billing address in a Customer's personal
 * address book (feature 040, US2 / FR-008/FR-038). The partial unique index
 * "one default per (customer, kind)" is enforced in the migration, mirroring
 * the org-level `addresses` table.
 *
 * **Retired** (`specs/173-b2c-address-book-merge/` release 1): nothing writes a
 * new row. The retirement job moves every live B2C row into the personal
 * Organization's book — recording where it went in `mergedIntoAddressId` and
 * `mergedAt` — and erases every other live row; a row `addresses` refused stays
 * live with the reason in `mergeRefusal`. Release 2 drops the table.
 */
@CustomerScoped()
@Entity({ tableName: 'customer_addresses' })
export class CustomerAddress {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'isDefault'
    | 'phone'
    | 'deletedAt'
    | 'mergedIntoAddressId'
    | 'mergedAt'
    | 'mergeRefusal';

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

  /** The Organization address this row was moved into (provenance; never joined). */
  @Property({ type: 'uuid', nullable: true })
  mergedIntoAddressId?: string | null;

  @Property({ type: 'datetime', nullable: true })
  mergedAt?: Date | null;

  /** The owner's error code when `addresses` refused the move; the row then stays live. */
  @Property({ type: 'string', length: 64, nullable: true })
  mergeRefusal?: string | null;
}
