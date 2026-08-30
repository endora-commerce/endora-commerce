import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { CustomerScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * PushSubscription (feature 046, US4). One subscribed storefront device/browser —
 * a standard Web-Push subscription (endpoint + p256dh + auth). Idempotent on
 * `endpoint` (upsert on re-subscribe). `customerAccountId` is null for anonymous
 * devices (FR-023). Constraints/indexes are declared in migration 080.
 */
@CustomerScoped()
@Entity({ tableName: 'push_subscriptions' })
@Unique({ properties: ['endpoint'] })
export class PushSubscription {
  [OptionalProps]?:
    | 'id'
    | 'createdAt'
    | 'lastSeenAt'
    | 'status'
    | 'provider'
    | 'customerAccountId'
    | 'organizationId'
    | 'userAgent';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  @Index()
  salesChannelId!: string;

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
   * organisation sees this device because this column is here.
   *
   * Nullable, and the constraint is an implication rather than an equivalence:
   * `push_subscriptions_organization_attribution_chk` requires an organisation
   * of a row that names an account and says nothing about a row that names
   * none. An **anonymous** device is a representable state (FR-011, FR-023) —
   * a browser subscribes before anybody signs in — and who such a row belongs
   * to is R-6's open question, which a constraint must not answer.
   *
   * It moves in **both** directions with {@link customerAccountId}, because
   * this table's write is an upsert on `endpoint`: signing in on a device
   * stamps the account and the organisation together, and re-subscribing that
   * same device anonymously clears both. The second direction is the one the
   * implication does not cover — an ownerless row keeping an organisation is
   * a disclosure the schema permits — so it is held by the service's resolved
   * owner type and by a test, not by the check.
   */
  @Property({ type: 'uuid', nullable: true })
  @Index()
  organizationId?: string | null;

  @Property({ type: 'text' })
  endpoint!: string;

  @Property({ type: 'text' })
  p256dh!: string;

  @Property({ type: 'text' })
  auth!: string;

  @Property({ type: 'string', length: 32 })
  provider: string = 'web_push';

  @Property({ type: 'string', length: 16 })
  status: 'active' | 'invalid' = 'active';

  @Property({ type: 'text', nullable: true })
  userAgent?: string | null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime' })
  lastSeenAt: Date = new Date();
}
