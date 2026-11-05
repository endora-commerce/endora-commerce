---
'@endora-commerce/contracts': patch
'@endora-commerce/mod-audit-logs': patch
'@endora-commerce/admin-shell': patch
'@endora-commerce/mod-i18n': patch
---

The audit log names a customer who acted for themselves (issue #741; `specs/170-organization-roles/` FR-065). Before this change, a role, invitation or member change made by an Organization administrator on the storefront was shown as *system*.

- `@endora-commerce/contracts`: `auditLogEntrySchema` gains `actorCustomerAccountId`, nullable and optional. A payload without it still parses.
- `@endora-commerce/mod-audit-logs`: each row from `GET /api/v1/admin/audit-log` carries `actorCustomerAccountId` and `actorCustomerLabel`. The label comes from the `customer_account` audit reference, the same lookup already used for impersonated customers. The audit log viewer renders such a row as *Customer: <label>*. In `GET /api/v1/admin/audit-log/recent-activity`, `actorKind` gains the value `customer`. For those rows `actorDisplayName` is the customer's label. A consumer that switches on `actorKind` must handle the new value.
- `@endora-commerce/admin-shell`: the Recent activity card prefixes a customer actor with *Customer:*.
- `@endora-commerce/mod-i18n`: adds `auditLog.actor.customer` and `home.activity.actor.customer` in English and Polish.
