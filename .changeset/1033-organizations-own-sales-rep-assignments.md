---
'@endora-commerce/mod-organizations': patch
---

`organizations` now creates its own `organization_sales_rep_assignments` table (issue #1033,
`specs/178-extensible-columns/` D-291 R-A8). Until now only `quote_requests` created it, so a
platform that composed `organizations` without `quote_requests` failed on
`Migration20261109T144721OrganizationsReachGovernor`, whose triggers name the table. That
migration's `up()` now begins with `create table if not exists` and `create index if not exists`
for the table and its two indexes, with the same columns, constraint names and index names as
before. The two indexes are now created only here. No new migration is added and no migration class is renamed. A database that has already
applied the migration does not run it again and does not change.
