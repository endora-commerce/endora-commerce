import { randomUUID } from 'node:crypto';
import { Entity, OptionalProps, PrimaryKey, Property } from '@mikro-orm/core';
import { CustomerScoped } from '@endora-commerce/platform/tenancy';

/**
 * One entry in a buyer's notification centre
 * (`specs/179-rfq-and-customer-notifications/` data-model §2).
 *
 * `@CustomerScoped` with a stamped {@link organizationId} — the D-187 pattern
 * `PushNotificationPreference` follows (research R-18): the column is what lets
 * the customer filter's `allowed-set` arm grant a sales representative assigned
 * to the buyer's Organization (Principle XI). Both ids are required, and
 * `customer_notifications_attribution_chk` holds that in the database.
 *
 * `salesChannelId` is the channel the entry concerns, `null` for every channel
 * (Principle XII); the storefront list shows an entry on its own channel only.
 *
 * No foreign key to `customer_accounts`, `organizations` or `sales_channels`:
 * those are other modules' tables, and this module must be detachable
 * (Principle I). The entries of an account that is deleted or anonymised are
 * removed by the retention sweep's second pass.
 *
 * Written only through the record port and the read marks of the storefront
 * API — notification bookkeeping, not an audited domain write (research R-19).
 */
@CustomerScoped()
@Entity({ tableName: 'customer_notifications' })
export class CustomerNotification {
  [OptionalProps]?:
    | 'id'
    | 'salesChannelId'
    | 'subjectType'
    | 'subjectId'
    | 'body'
    | 'bodyMessage'
    | 'linkPath'
    | 'createdAt'
    | 'readAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'uuid' })
  organizationId!: string;

  @Property({ type: 'uuid' })
  customerAccountId!: string;

  @Property({ type: 'uuid', nullable: true })
  salesChannelId?: string | null;

  @Property({ type: 'string', length: 64 })
  sourceModule!: string;

  @Property({ type: 'string', length: 128 })
  sourceKey!: string;

  @Property({ type: 'string', length: 64 })
  kind!: string;

  @Property({ type: 'string', length: 64, nullable: true })
  subjectType?: string | null;

  @Property({ type: 'uuid', nullable: true })
  subjectId?: string | null;

  /** The English sentence, shown when {@link titleMessage} does not resolve. */
  @Property({ type: 'string', length: 255 })
  title!: string;

  @Property({ type: 'json' })
  titleMessage!: StoredCustomerNotificationMessage;

  @Property({ type: 'text', nullable: true })
  body?: string | null;

  /** `body`, translatable — never without a `body` to fall back to. */
  @Property({ type: 'json', nullable: true })
  bodyMessage?: StoredCustomerNotificationMessage | null;

  /** Storefront-relative: one leading `/`, never `//` (FR-047). */
  @Property({ type: 'string', length: 512, nullable: true })
  linkPath?: string | null;

  /**
   * Millisecond precision in the column (`timestamptz(3)`), the precision of a
   * JavaScript `Date`: the list's keyset cursor carries this value, and a
   * column finer than the cursor would make two pages disagree about which
   * entries came before it.
   */
  @Property({ type: 'datetime', length: 3 })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', length: 3, nullable: true })
  readAt?: Date | null;
}

/** A message as it is stored: always with `params`, empty when it takes none. */
export interface StoredCustomerNotificationMessage {
  scope: string;
  key: string;
  params: Record<string, string | number>;
}
