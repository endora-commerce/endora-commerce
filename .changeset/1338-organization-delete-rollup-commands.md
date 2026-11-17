---
'@endora-commerce/mod-organizations': minor
'@endora-commerce/mod-customer-accounts': patch
---

Issue #1338: two operator writes on the organization screens now run as Commands on the Command Bus, so each write and its audit entry commit together. Before, the audit entry was written after the change was saved, and a failure in between left a change with no audit entry.

- Deleting an organization (`DELETE /api/v1/admin/organizations/:id`) runs the `organization.delete` Command. The response, the `404` and the `409 has_children` refusal are unchanged, and so is the entry: the status, VAT status, whether it is personal, the parent by id and the version.
- Turning a member's roll-up on or off (`PATCH /api/v1/admin/organizations/:id/members/:customerAccountId/rollup`) runs the `customer_account.set_subtree_rollup` Command of `customer_accounts`, which records the flag before and after and names the operator. Each toggle now writes this one entry. The second, hand-written `customer_account.admin_rollup_change` entry is no longer recorded. If you filter the audit log on `customer_account.admin_rollup_change`, filter on `customer_account.set_subtree_rollup` instead. Older entries keep their action.
