---
'@endora-commerce/contracts': minor
---

New `auditLogFacetsSchema` / `AuditLogFacetsResponse`: the body of `GET /api/v1/admin/audit-log/facets`, the actions the audit log holds (each with the `moduleId` whose bundle labels `auditLog.<action>`) and the object types (issue #1555).
