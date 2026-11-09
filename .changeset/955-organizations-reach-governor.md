---
'@endora-commerce/mod-organizations': patch
---

A sales representative's reach is read from a new table, `organization_reach_governor` (issue #955): for each organization, the nearest ancestor-or-self that carries a sales-representative assignment. Migration `20261109T144721_organizations_reach_governor` creates it, backfills it, and keeps it current through statement-level triggers on `organizations` and `organization_sales_rep_assignments`, inside the transaction of every write — the admin Commands, the assignment service, the demo reset and raw SQL alike. `SalesRepAssignmentService.reachOf` is one scan of that table instead of a path probe per assigned organization. The rule is unchanged (`canSeeOrganization`), and nothing is cached. The upgrade runs the backfill once; nothing else is needed.
