---
'@endora-commerce/mod-organizations': minor
---

A sales representative's reach is read from a new table, `organization_reach_governor` (issue #955): for each organization, the nearest ancestor-or-self that carries a sales-representative assignment. Migration `20261109T144721_organizations_reach_governor` creates it, backfills it, and keeps it current through statement-level triggers on `organizations` and `organization_sales_rep_assignments`, inside the transaction of every write — the admin Commands, the assignment service, the demo reset and raw SQL alike — under one transaction-scoped advisory lock. It also adds `organizations_reach_excluded(admin_user_id, rollup)`, the one definition of a representative's excluded set: `SalesRepAssignmentService.reachOf` reads it, and `adminTenantScopePort` answers it as `excludedOrganizationsQuery`, which the tenant filter renders as a subquery. The rule is unchanged (`canSeeOrganization`), and nothing is cached.

**Operations.** A data-only restore with `--disable-triggers` leaves the table stale; run `select organizations_reach_governor_rebuild(null);` afterwards. Every assignment write, organization insert and tree move now serialises on one advisory lock until its transaction commits.
