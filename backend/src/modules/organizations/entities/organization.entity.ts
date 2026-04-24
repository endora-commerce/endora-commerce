import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { randomUUID } from 'crypto';

/**
 * Organization — the buyer-side legal entity. Owns Customer Accounts,
 * Addresses, and (via FKs that land with later US) Quote Requests, Orders,
 * and Credit Limits.
 *
 * `taxId` is globally unique in the installation (Polish NIP by default; the
 * exact format is spec-validated at the Zod boundary).
 */
@Entity({ tableName: 'organizations' })
export class Organization {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'status'
    | 'vatStatus'
    | 'deletedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 255 })
  @Index()
  name!: string;

  @Property({ type: 'string', length: 32 })
  @Unique()
  taxId!: string;

  @Property({ type: 'string', length: 32 })
  @Index()
  status: 'pending_verification' | 'active' | 'suspended' = 'pending_verification';

  @Property({ type: 'string', length: 16 })
  vatStatus: 'vat_payer' | 'vat_exempt' | 'reverse_charge' = 'vat_payer';

  /** JSONB snapshot of { street, city, postalCode, country }. */
  @Property({ type: 'json' })
  registeredAddress!: {
    street: string;
    city: string;
    postalCode: string;
    country: string;
  };

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();

  @Property({ type: 'datetime', nullable: true })
  deletedAt?: Date | null;
}
