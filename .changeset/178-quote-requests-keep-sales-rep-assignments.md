---
'@endora-commerce/mod-quote-requests': patch
---

`module:uninstall quote_requests --hard` no longer drops `organization_sales_rep_assignments` (`specs/178-extensible-columns/` D-291 R-A7). The table was created by `Migration20260503T141344QuoteRequestsWorkflow`, but `organizations` maps it and outlives `quote_requests`, so the migration's `down()` destroyed a live `organizations` table and its sales-representative assignments. The `drop table` is removed from that `down()`; no applied history changes.
