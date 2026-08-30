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
    | 'organizationId'
    | 'email'
    | 'status';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid', nullable: true })
  @Index()
  customerAccountId?: string | null;

  /**
   * The organisation that owns this subscription — feature 087 Group B, ruling
   * D-187.
   *
   * Derived from {@link customerAccountId}'s account and stamped at the write,
   * never resolved on read: `customerOrganizationColumn` asks the ORM's own
   * metadata whether this property exists, so its presence is what makes
   * `customerFilterCond`'s `allowed-set` arm **grant** on this table rather
   * than refuse it whole. A sales representative assigned to the buyer's
   * organisation sees this subscription because this column is here.
   *
   * Nullable, and the constraint is an implication rather than an equivalence:
   * `availability_notifications_organization_attribution_chk` requires an
   * organisation of a row that names an account, and says nothing about a row
   * that names none. An **anonymous** subscription is a representable state
   * (FR-011) — `an_recipient_check` admits a row whose only recipient is an
   * e-mail address, which is the storefront's "notify me" dialog with nobody
   * signed in — and who such a row belongs to is R-6's open question, which a
   * constraint must not answer.
   *
   * There is no association path to keep in step: nothing in this module ever
   * assigns {@link customerAccountId} on an existing row, so unlike
   * `comparisons` and `pwa` this column moves exactly once, at the insert.
   */
  @Property({ type: 'uuid', nullable: true })
  @Index()
  organizationId?: string | null;

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
