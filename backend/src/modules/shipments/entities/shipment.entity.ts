import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { GlobalEntity } from '../../../tenancy/org-scoped.decorator.js';
import { randomUUID } from 'crypto';

/**
 * Shipment (Przesyłka / Paczka) — a first-class record of one
 * shipment-generation attempt against an Order (feature 035). An Order may
 * have several: a failed generation followed by a successful retry, or a
 * future split into multiple parcels. The delivery-side twin of `Payment`.
 *
 * `status` is the shipment-process status (pending → success | failure),
 * distinct from the Order status the method maps to on a `receive_shipment`
 * outcome.
 */
@GlobalEntity()
@Entity({ tableName: 'shipments' })
export class Shipment {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | 'status'
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
  deliveryMethodId!: string;

  @Property({ type: 'string', length: 32 })
  @Index()
  status: 'pending' | 'success' | 'failure' = 'pending';

  /** Carrier/adapter reference (e.g. tracking number) for idempotent matching. */
  @Property({ type: 'string', length: 255, nullable: true })
  externalReference?: string | null;

  /** Adapter/carrier payload captured on receive_shipment. */
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
