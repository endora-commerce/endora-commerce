import { Entity, Index, OptionalProps, PrimaryKey, Property, Unique } from '@mikro-orm/core';
import { OrgScoped } from '@endora-commerce/platform/tenancy';
import { randomUUID } from 'crypto';

export type CrmOpportunityValueMode = 'manual' | 'computed';
export type CrmOpportunitySource = 'manual' | 'order' | 'quote_request';
export type CrmOpportunityClosedKind = 'won' | 'lost';

/**
 * A Sales Opportunity — an admin-side record *about* an Organization.
 *
 * `@OrgScoped` on a non-null `organizationId` (Constitution XI), the
 * classification `QuoteRequest` and `CreditLimit` carry: the tenant filter
 * gives a scoped admin exactly the Opportunities of the Organizations they may
 * see, with no predicate written by hand, and an out-of-scope Opportunity is
 * indistinguishable from a missing one. There is no no-organization path.
 *
 * `organizationId` and `salesChannelId` are foreign keys (`on delete
 * restrict`). `customerAccountId` and `assignedAdminUserId` are held by value
 * and validated through their owners' ports. `salesChannelId` is an
 * attribution and a filter, not channel-scoped content; `null` means no
 * channel, never a default.
 *
 * The effective value is `manualValue` or `computedValue`, by `valueMode`.
 * Money is `numeric(14,2)` held as a string, as `orders.total` is.
 */
@OrgScoped()
@Entity({ tableName: 'crm_opportunities' })
@Index({ properties: ['organizationId', 'statusCode'] })
@Index({ properties: ['assignedAdminUserId', 'statusCode'] })
@Index({ properties: ['closedKind', 'closedAt'] })
export class CrmOpportunity {
  [OptionalProps]?:
    | 'id'
    | 'description'
    | 'customerAccountId'
    | 'salesChannelId'
    | 'assignedAdminUserId'
    | 'valueMode'
    | 'manualValue'
    | 'computedValue'
    | 'expectedCloseDate'
    | 'source'
    | 'closedAt'
    | 'closedKind'
    | 'createdByAdminUserId'
    | 'version'
    | 'createdAt'
    | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  /** `OPP-` + the zero-padded value of `crm_opportunity_number_seq`. */
  @Property({ type: 'string', length: 32 })
  @Unique()
  number!: string;

  @Property({ type: 'string', length: 200 })
  title!: string;

  /** Plain text carrying reference tokens; never HTML. */
  @Property({ type: 'text', nullable: true })
  description?: string | null;

  @Property({ type: 'uuid' })
  @Index()
  organizationId!: string;

  /** The contact person; belongs to the Organization. */
  @Property({ type: 'uuid', nullable: true })
  customerAccountId?: string | null;

  @Property({ type: 'uuid', nullable: true })
  @Index()
  salesChannelId?: string | null;

  /** A `crm_opportunity_statuses.code`, by value. */
  @Property({ type: 'string', length: 64 })
  @Index()
  statusCode!: string;

  @Property({ type: 'uuid', nullable: true })
  @Index()
  assignedAdminUserId?: string | null;

  @Property({ type: 'string', length: 8 })
  valueMode: CrmOpportunityValueMode = 'manual';

  @Property({ type: 'decimal', precision: 14, scale: 2, nullable: true })
  manualValue?: string | null;

  /** A derived figure, maintained from the linked documents. */
  @Property({ type: 'decimal', precision: 14, scale: 2 })
  computedValue: string = '0.00';

  /** ISO 4217. Immutable after create. */
  @Property({ type: 'string', length: 3 })
  currency!: string;

  @Property({ type: 'date', nullable: true })
  expectedCloseDate?: string | null;

  @Property({ type: 'string', length: 16 })
  source: CrmOpportunitySource = 'manual';

  /** Set on entering a `won` / `lost` status, cleared on leaving one. */
  @Property({ type: 'datetime', nullable: true })
  @Index()
  closedAt?: Date | null;

  @Property({ type: 'string', length: 8, nullable: true })
  closedKind?: CrmOpportunityClosedKind | null;

  /** `null` for an Opportunity created automatically. */
  @Property({ type: 'uuid', nullable: true })
  createdByAdminUserId?: string | null;

  /** Optimistic concurrency on PATCH (`If-Match`). */
  @Property({ type: 'integer' })
  version: number = 0;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  @Index()
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
