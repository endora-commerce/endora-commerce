import { OptionalProps } from '@mikro-orm/core';
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy';
import { TransitivelyScoped } from '@endora-commerce/platform/tenancy';

/**
 * QuoteRequestAccountPolicy — a per-customer-account override of the
 * organization's price-negotiation setting (feature 146, US4, data-model §6).
 *
 * One row per account, keyed by `customerAccountId`. `priceProposalsAllowed`
 * is `null` for "as organization", `true` / `false` for an explicit override;
 * **no row** also means "as organization". Written only by the
 * `quote_request_policy.customer_account.set` Command after its authority check
 * (`findInOrganization` + `canSeeOrganization`), as find, then create or
 * assign — never `em.upsert` / `nativeUpdate` (threat model T2).
 *
 * Classified `@TransitivelyScoped('CustomerAccount', 'customerAccountId')`
 * (research R10): the row follows the account, which may move between
 * organizations, so it carries no organization column of its own that could go
 * stale. The chain grounds at `CustomerAccount`, which is `@OrgScoped` and owned
 * by `customer_accounts`, a binding dependency of this module.
 *
 * **This classification attaches no query filter** (plan I1, proven by
 * `backend/test/integration/quote_requests/pricing-history-schema.test.ts`):
 * `TransitivelyScoped` registers the chain, which the host validates at boot,
 * and nothing else — a bare `findOne` of this entity returns the row in any
 * tenant context. So every read must establish its tenant explicitly:
 *
 *  - **enforcement** reads the row by exact primary key under a named system
 *    scope, for an owner the caller has already authorised (research R11,
 *    threat model T1) — it never relied on a filter;
 *  - **admin reads** first load the `CustomerAccount` through its own
 *    `@OrgScoped` filter (or the customer-account read port's scoped lookup)
 *    and read this row only for an account that answered.
 */
@TransitivelyScoped('CustomerAccount', 'customerAccountId')
@Entity({ tableName: 'quote_request_account_policies' })
export class QuoteRequestAccountPolicy {
  [OptionalProps]?: 'priceProposalsAllowed' | 'createdAt' | 'updatedAt';

  @PrimaryKey({ type: 'uuid' })
  customerAccountId!: string;

  /** `null` = as organization; `true` = allowed; `false` = not allowed. */
  @Property({ type: 'boolean', nullable: true })
  priceProposalsAllowed?: boolean | null = null;

  @Property({ type: 'datetime', onCreate: () => new Date() })
  createdAt: Date = new Date();

  @Property({ type: 'datetime', onUpdate: () => new Date() })
  updatedAt: Date = new Date();
}
