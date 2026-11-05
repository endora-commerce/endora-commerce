---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-audit-logs': minor
'@endora-commerce/admin-shell': minor
'@endora-commerce/mod-i18n': minor
'@endora-commerce/mod-customer-accounts': minor
---

The audit log names a customer who acted for themselves (issue #741; `specs/170-organization-roles/` FR-065). Before this change, a role, invitation or member change made by an Organization administrator on the storefront was shown as *system*.

- `@endora-commerce/contracts`: `auditLogEntrySchema` gains `actorCustomerAccountId`, nullable and optional. A payload without it still parses.
- `@endora-commerce/mod-audit-logs`: each row from `GET /api/v1/admin/audit-log` carries `actorCustomerAccountId` and `actorCustomerLabel`. The label comes from the `customer_account` audit reference, the same lookup already used for impersonated customers. The audit log viewer renders such a row as *Customer: <label>*. The audit log viewer falls back to the short account id when there is no label.
- **Breaking:** in `GET /api/v1/admin/audit-log/recent-activity`, `actorKind` gains the value `'customer'` beside `'admin'` and `'system'`. For those rows `actorDisplayName` is the customer's label. A consumer that switches exhaustively on `actorKind` must handle the new value.
- `@endora-commerce/admin-shell`: the Recent activity card prefixes a customer actor with *Customer:*.
- `@endora-commerce/mod-customer-accounts`: the `customer_account` audit reference now names the person as `<first> <last> (<e-mail>)`, or the e-mail alone when the account has no name. Before, it was the Organization's name. Impersonation rows (`… (as <customer>)` on Recent activity) now name the person too. `registerCustomerAccountAuditReferences` no longer takes an `OrganizationDetailsPort`.
- `@endora-commerce/mod-i18n`: adds `auditLog.actor.customer` and `home.activity.actor.customer` in English and Polish.
