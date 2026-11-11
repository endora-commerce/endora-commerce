---
'@endora-commerce/mod-organizations': minor
---

Custom-field values from server-side code, and the admin Organization edit on the Command Bus.

- Publishes `organizationCustomFieldWritePort` (`OrganizationCustomFieldWritePort` in `@endora-commerce/contracts`). Resolve it with `lazyPort` and declare `organizations` in your manifest `dependencies`. Each call runs one `organization.set_custom_field_values` Command, whose audit entry names the custom-field keys that changed (`changedCustomFields`) and carries none of their values. Writing `organizations.custom_field_values` directly is not a supported alternative.
- `PATCH /api/v1/admin/organizations/:id` now runs as one `organization.admin_patch` Command. The `expectedUpdatedAt` check, the column changes and the custom-field merge share one transaction, and the audit entry is written in that same transaction rather than after the flush. The request, the response, the `409 VERSION_CONFLICT` and the `422 CUSTOM_FIELD_VALUE_INVALID` envelope are unchanged. A refused value still writes nothing, including the other columns in the same request. There is still one entry per PATCH, with the same action and snapshot. That entry no longer carries the request's `X-Request-Id` (the Command Bus does not stamp one, as on every other Command).
