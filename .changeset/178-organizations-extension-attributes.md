---
'@endora-commerce/mod-organizations': minor
'@endora-commerce/contracts': minor
---

`organizations` is an extensible host for declared extension columns (`specs/178-extensible-columns/` FR-051, FR-052). `GET /api/v1/admin/organizations/:id` and `GET /api/v1/admin/organizations` accept `?extensions=<moduleId>[,<moduleId>…]` (at most eight, `ExtensionsQuerySchema`) and then return `extensions` on every record: per named module that declares columns on `organizations` with `adminReads: true` and is present, its declared keys and values. A module that is switched off, not installed or not exposing the host is omitted without an error; a malformed parameter answers 400. Without the parameter both responses are byte-identical to before. `@endora-commerce/contracts` publishes the record shape as `adminOrganizationSchema` (`organizationSchema` plus optional `extensions`, `AdminOrganization`).
