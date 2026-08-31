import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { CustomerScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

/**
 * NewsletterSubscriber — feature 048. Identity is the email (global unique).
 * `status` drives mailability (only `active` + not suppressed is mailable).
 * `customFields` holds operator-defined values keyed by NewsletterCustomField.key.
 */
@CustomerScoped()
@Entity({ tableName: 'newsletter_subscribers' })
export class NewsletterSubscriber {
  [OptionalProps]?:
    | 'status'
    | 'source'
    | 'salesChannelId'
    | 'customerAccountId'
    | 'organizationId'
    | 'customFields'
    | 'consentAt'
    | 'confirmedAt'
    | 'unsubscribedAt'
    | 'unsubscribeReason'
    | 'deactivatedAt'
    | 'version'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Property({ type: 'string', length: 320 })
  @Unique()
  email!: string;

  @Property({ type: 'string', length: 16 })
  @Index()
  status: 'pending' | 'active' | 'unsubscribed' | 'deactivated' = 'pending';

  @Property({ type: 'string', length: 64, nullable: true })
  source: string | null = null;

  @Property({ type: 'uuid', fieldName: 'sales_channel_id', nullable: true })
  @Index()
  salesChannelId: string | null = null;

  @Property({ type: 'uuid', fieldName: 'customer_account_id', nullable: true })
  customerAccountId: string | null = null;

  /**
   * The organisation that owns this subscriber — feature 087 Group B, ruling
   * D-187.
   *
   * Derived from {@link customerAccountId}'s account and stamped at the write,
   * never resolved on read: `customerOrganizationColumn` asks the ORM's own
   * metadata whether this property exists, so its presence is what makes
   * `customerFilterCond`'s `allowed-set` arm **grant** on this table rather
   * than refuse it whole. A sales representative assigned to the buyer's
   * organisation sees this subscriber, and their CSV export of it, because
   * this column is here.
   *
   * Nullable, and the constraint is an implication rather than an equivalence:
   * `newsletter_subscribers_organization_attribution_chk` requires an
   * organisation of a row that names an account and says nothing about a row
   * that names none. On this table the ownerless row is the ordinary case
   * rather than the edge — `POST /api/v1/newsletter/subscribe` passes no
   * account at all, so every subscriber who has never signed in is one — and
   * who they belong to is R-6's open question, which a constraint must not
   * answer.
   *
   * It is written together with {@link customerAccountId} at both of this
   * module's two write sites, and there is no third: `subscriber.service.ts`
   * creates the row with an owner or without one, and adopts an ownerless row
   * into an account when a subscriber who signed up anonymously later signs
   * in. Nothing here ever clears the account, so unlike `pwa` there is no
   * de-association direction, and unlike `pwa` the shape the implication
   * leaves open — an ownerless row still carrying an organisation — is not
   * reachable.
   *
   * **Not derived from {@link email}.** This column is globally unique and
   * `customer_accounts` has an e-mail too, so a match is available and is
   * deliberately not taken: it would attribute rows the schema does not link,
   * silently and irreversibly, for whoever signed up with the address their
   * employer later registered. That is R-6 answer (2) guessed rather than
   * decided.
   */
  @Property({ type: 'uuid', fieldName: 'organization_id', nullable: true })
  @Index()
  organizationId: string | null = null;

  @Property({ type: 'json', fieldName: 'custom_fields' })
  customFields: Record<string, string | number | boolean | null> = {};

  @Property({ type: 'datetime', fieldName: 'consent_at', nullable: true })
  consentAt: Date | null = null;

  @Property({ type: 'datetime', fieldName: 'confirmed_at', nullable: true })
  confirmedAt: Date | null = null;

  @Property({ type: 'datetime', fieldName: 'unsubscribed_at', nullable: true })
  unsubscribedAt: Date | null = null;

  @Property({ type: 'text', fieldName: 'unsubscribe_reason', nullable: true })
  unsubscribeReason: string | null = null;

  @Property({ type: 'datetime', fieldName: 'deactivated_at', nullable: true })
  deactivatedAt: Date | null = null;

  @Property({ type: 'integer' })
  version: number = 1;

  @Property({ type: 'datetime', fieldName: 'created_at', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', fieldName: 'updated_at', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
