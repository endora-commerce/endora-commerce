---
'@endora-commerce/mod-organizations': minor
---

**Four Organization writes are hookable** (`specs/176-command-hooks-outbox/` FR-024): `organization.create`, `organization.register`, `organization.admin_patch` and `organization.set_custom_field_values`, both phases, listed in the manifest's `hookableActions` from `ORGANIZATION_HOOKABLE_ACTIONS`. Each Command supplies `hookData` (the uncommitted `OrganizationRecord` plus the channels, the first account, or the names of what changed — never the registration's verification token) and list-1 `outboxData`, and accepts `extensions` from a server-side caller. No HTTP body carries `extensions` yet. A hook's noted changes appear in the Organization's audit entry as names under `extensions.<moduleId>.changedFields`; `ORGANIZATION_AUDIT_KEYS` lists `extensions`. With no hook module installed nothing changes.
