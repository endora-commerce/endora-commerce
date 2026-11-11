---
'@endora-commerce/contracts': minor
---

New port contract `OrganizationCustomFieldWritePort` (container name `organizationCustomFieldWritePort`, owner `organizations`): the server-side write of an Organization's custom-field values, for a subscriber, an overlay module or an integration worker. Additive.

- `setCustomFieldValues(organizationId, merge): Promise<OrganizationRecord>`, where `merge: (current: Record<string, unknown>) => Promise<Record<string, unknown>>`. It has the same semantics as `CustomerAccountLifecycleWritePort.setCustomFieldValues`.
- The owner runs the caller's `merge` between its load and its write, as one Command with one audit row. It does **not** validate: call `CustomFieldValuePort.validateAndMerge` inside `merge`. A throwing `merge` writes nothing and its error propagates unchanged. An unknown or deleted Organization throws `404 NOT_FOUND` before `merge` runs.
- The actor is the ambient tenant context's. A subscriber on `organization.registered.v1` records none (the system). The write runs after registration commits, not inside it.
