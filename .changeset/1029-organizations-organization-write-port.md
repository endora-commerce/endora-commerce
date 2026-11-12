---
'@endora-commerce/mod-organizations': minor
---

Publishes `organizationWritePort` (`OrganizationWritePort` in `@endora-commerce/contracts`), so another module can find Organizations by tax ID, create one and update its identity fields without calling the admin HTTP API. Resolve it with `lazyPort` and declare `organizations` in your manifest `dependencies`.

- `create` runs the existing `organization.create` Command through the same wrapper as the admin create, so a tax ID the active scope refuses answers `409 ORGANIZATION_TAX_ID_EXISTS`. When a `legalName` is given, the Command stores it and its audit entry names `legalName` among `changedFields`. The admin create (`POST /api/v1/admin/organizations`) does not send one, and its behaviour and audit entry are unchanged.
- `update` runs the new `organization.update` Command. Its audit entry records the VAT status before and after and the sorted names of the changed fields, never their values. An update that changes nothing writes nothing, records nothing and does not move the version. `PATCH /api/v1/admin/organizations/:id` is unchanged.
