---
'@endora-commerce/platform': minor
---

`AuditPort` (`@endora-commerce/platform/kernel`) gains `queryFacets()`, which answers the actions the audit log holds and the object types they were recorded for (`AuditLogFacets`), at a cost bounded by the number of distinct actions rather than by the number of rows. `AuditLogFilter` gains `after?: AuditLogPosition` (`{ actedAt, id }`) for keyset pages, and `query()` now orders by `actedAt desc, id desc`, so a page boundary neither skips nor repeats an entry (issue #1555). A hand-written `AuditPort` test double must add `queryFacets`.
