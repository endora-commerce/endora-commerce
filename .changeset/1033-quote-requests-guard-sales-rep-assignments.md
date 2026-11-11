---
'@endora-commerce/mod-quote-requests': patch
---

`Migration20260503T141344QuoteRequestsWorkflow` now creates `organization_sales_rep_assignments`
with `create table if not exists`, and no longer creates the table's two indexes
`orgsa_admin_user_idx` and `orgsa_organization_idx` (issue #1033,
`specs/178-extensible-columns/` D-291 R-A8). The table belongs to `organizations`, which now
creates the table and both indexes itself. On a platform that migrated `organizations` first and
installs `quote_requests` later, this migration used to fail with
`relation "organization_sales_rep_assignments" already exists`. It now leaves the table and its
rows as they are. A database that has already applied the migration does not run it again. On a
fresh database the table ends up with the same columns, constraints and indexes as before.
