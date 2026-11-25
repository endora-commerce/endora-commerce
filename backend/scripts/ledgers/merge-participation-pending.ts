/**
 * The references `check:merge-participation` lets stand undeclared, while the
 * participants of `specs/192-organization-merge/` are delivered
 * (`contracts/merge-participation-check.md` §3).
 *
 * Seeded from the check's own `--undeclared` output, and **only shrinks**: an
 * entry whose reference is now declared, or no longer exists, is
 * `stale-pending` and fails the check until it is removed. Each entry names the
 * task that removes it (`specs/192-organization-merge/tasks.md`). The runtime
 * twin never reads this ledger: a ledgered reference of an effectively present
 * module still refuses a merge start with `RECORD_MERGE_PARTICIPATION_INCOMPLETE`,
 * so nothing can be stranded while it is not empty.
 */
export interface MergeParticipationPendingEntry {
  readonly moduleId: string;
  readonly entity: string;
  readonly property: string;
  /** The task in `specs/192-organization-merge/tasks.md` that declares it. */
  readonly removedBy: string;
}

/**
 * Polymorphic references (`PriceDisplayModeOverride` and `QuickOrderDefaultPreference`
 * by `scope`, `PromotionUsageCounter` by `scopeType`) are not here: a column
 * holding a host id under a discriminator cannot be found by its name, so it
 * enters the population with its participant's declaration
 * (`contracts/participant-dispositions.md` §A), not before.
 */
export const MERGE_PARTICIPATION_PENDING: readonly MergeParticipationPendingEntry[] = [
  { moduleId: 'catalog', entity: 'Product', property: 'allowedOrganizationIds', removedBy: 'T064' },
  { moduleId: 'catalog', entity: 'ProductChannelScope', property: 'allowedOrganizationIds', removedBy: 'T064' },
  { moduleId: 'crm', entity: 'CrmOpportunity', property: 'organizationId', removedBy: 'T062' },
  { moduleId: 'customer_accounts', entity: 'CustomerAccount', property: 'organizationId', removedBy: 'T070' },
  { moduleId: 'orders', entity: 'Order', property: 'organizationId', removedBy: 'T058' },
  { moduleId: 'orders', entity: 'Order', property: 'payerOrganizationId', removedBy: 'T058' },
  { moduleId: 'orders', entity: 'OrderExternalReference', property: 'organizationId', removedBy: 'T058' },
  { moduleId: 'orders', entity: 'OrderPlacementIntent', property: 'organizationId', removedBy: 'T058' },
  { moduleId: 'orders', entity: 'OrderTransitionEffect', property: 'organizationId', removedBy: 'T058' },
  { moduleId: 'projects', entity: 'ProjectLink', property: 'organizationId', removedBy: 'T066' },
  { moduleId: 'projects', entity: 'ProjectOrganization', property: 'organizationId', removedBy: 'T066' },
  { moduleId: 'quote_requests', entity: 'QuoteRequest', property: 'organizationId', removedBy: 'T060' },
  { moduleId: 'quote_requests', entity: 'QuoteRequestNotification', property: 'organizationId', removedBy: 'T060' },
  { moduleId: 'quote_requests', entity: 'QuoteRequestOrgPolicy', property: 'organizationId', removedBy: 'T060' },
];
