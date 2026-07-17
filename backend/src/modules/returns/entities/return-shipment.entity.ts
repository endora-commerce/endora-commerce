import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * ReturnShipment — feature 046 (US6, R8).
 *
 * Tracks the inbound return shipment (customer → shop) or a replacement
 * shipment (shop → customer) against a case. Inbound shipments are not order
 * shipments, so they live in this module-owned table rather than `shipments`.
 */
@GlobalEntity()
@Entity({ tableName: 'return_shipments' })
export class ReturnShipment {
  [OptionalProps]?:
    | 'id'
    | 'deliveryMethodId'
    | 'externalReference'
    | 'status'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  returnCaseId!: string;

  /** `inbound` (customer→shop) | `replacement` (shop→customer). */
  @Property({ type: 'string', length: 16 })
  direction!: 'inbound' | 'replacement';

  @Property({ type: 'uuid', nullable: true })
  deliveryMethodId?: string | null;

  @Property({ type: 'string', length: 128, nullable: true })
  externalReference?: string | null;

  /** `pending` | `received` | `failed`. */
  @Property({ type: 'string', length: 16 })
  status: 'pending' | 'received' | 'failed' = 'pending';

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
