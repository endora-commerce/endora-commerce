import { Entity, Index, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { CustomerScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * Availability "notify me when in stock" subscription (feature 010).
 *
 * Foundation 001 created this entity with `customerAccountId NOT NULL`;
 * feature 010 relaxes that to nullable + adds `email` + `status`
 * columns so anonymous customers can subscribe through the storefront
 * `Powiadom o dostępności` dialog. The DB-level CHECK constraint
 * (`an_recipient_check`) guarantees at least one of the two recipient
 * columns is populated.
 */
export type AvailabilityNotificationStatus = 'queued' | 'notified' | 'cancelled';

@CustomerScoped()
@Entity({ tableName: 'availability_notifications' })
export class AvailabilityNotification {
  [OptionalProps]?:
    | 'id'
    | 'requestedAt'
    | 'notifiedAt'
    | 'variantId'
    | 'customerAccountId'
    | 'email'
    | 'status';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid', nullable: true })
  @Index()
  customerAccountId?: string | null;

  @Property({ type: 'uuid' })
  @Index()
  productId!: string;

  @Property({ type: 'uuid', nullable: true })
  variantId?: string | null;

  @Property({ type: 'string', length: 320, nullable: true })
  email?: string | null;

  @Property({ type: 'string', length: 16 })
  status: AvailabilityNotificationStatus = 'queued';

  @Property({ type: 'datetime', onCreate: () => new Date() })
  requestedAt: Date = new Date();

  @Property({ type: 'datetime', nullable: true })
  notifiedAt?: Date | null;
}
