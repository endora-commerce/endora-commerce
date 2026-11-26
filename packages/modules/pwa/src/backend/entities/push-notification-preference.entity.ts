import { OptionalProps } from '@mikro-orm/core';
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy';
import { CustomerScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * A customer account's account-wide choice of which automatic push categories
 * it wants (`specs/149-pwa-order-status-push/` FR-017 – FR-019). One row per
 * account; **no row means both on** (research R-4), so nothing is seeded and a
 * read never writes.
 *
 * `@CustomerScoped` with a stamped {@link organizationId} — the D-187 pattern
 * `PushSubscription` follows: the column is what lets the customer filter's
 * `allowed-set` arm grant a sales representative assigned to the buyer's
 * organisation (Principle XI). Both ids are required: a preference always
 * belongs to an account, and every account has an organisation (D-178).
 * `push_notification_preferences_organization_attribution_chk` holds the
 * attribution rule itself in the database (D-187).
 *
 * No foreign key to `customer_accounts`, for the reason
 * `20260830T172022_pwa_organization_attribution.ts` writes down. Written only
 * through the `pwa.push_preference.update` Command (Principle XIII).
 */
@CustomerScoped()
@Entity({ tableName: 'push_notification_preferences' })
@Unique({
  properties: ['customerAccountId'],
  name: 'push_notification_preferences_customer_account_id_unique',
})
export class PushNotificationPreference {
  [OptionalProps]?: 'id' | 'orderStatusEnabled' | 'quoteStatusEnabled' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  customerAccountId!: string;

  @Property({ type: 'uuid' })
  @Index({ name: 'push_notification_preferences_organization_id_index' })
  organizationId!: string;

  @Property({ type: 'boolean' })
  orderStatusEnabled: boolean = true;

  @Property({ type: 'boolean' })
  quoteStatusEnabled: boolean = true;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
