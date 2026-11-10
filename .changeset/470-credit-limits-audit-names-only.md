---
'@endora-commerce/mod-credit-limits': minor
---

Issue #470 (D-288) — credit-limit audit entries carry names, never values. A credit limit is `@OrgScoped`, and the platform audit log is read under `audit_log:read` without Organization reach.

- `credit_limit.grant` records `changedFields: ['currency', 'grantedAmount']`. `credit_limit.adjust` records `changedFields: ['grantedAmount']` (or `[]` when the amount is unchanged). `credit_limit.credit_from_return` records `changedFields: ['grantedAmount']` and the `returnCaseId`.
- None of them records the granted amount, the currency or the Organization id (the tenant anchor) any longer. The entries are still recorded against the Organization (`objectId`).
- No credit-limit screen reads values back from the audit log, so no value store is added.
- Audit entries written before the upgrade are not rewritten (owner ruling O-4).

**Behaviour change on upgrade.** On the platform **Audit log** screen and in `audit_logs read`, new credit-limit entries show the changed field's name instead of the amounts. See *Credit-limit amounts leave the platform audit log* in the upgrade guide.
