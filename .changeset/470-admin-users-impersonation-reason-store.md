---
'@endora-commerce/mod-admin-users': minor
---

Issue #470 (D-288) — an impersonation's audit entry no longer carries the reason or the Organization. `impersonation.start` is recorded against a `@CustomerScoped` customer account, and the platform audit log is read under `audit_log:read` without Organization reach (`specs/conventions/audit-state.md` §2, §3).

- `impersonation.start` no longer records `reason` or `organizationId`. `stateAfter` is `{ hasReason, reasonLength?, organizationScoped, valueChangeId? }`: whether a reason was given and its length, whether the start named the account's Organization, and the id of the row that holds the reason.
- New table `admin_impersonation_reasons` (`ImpersonationReason`, `@CustomerScoped`; migration `Migration20261115T190121AdminUsersImpersonationReasons`) holds the reason, the account, its Organization and the administrator. One row per start that carried a reason, written in the same transaction as the audit entry and before the session is minted, so a start that fails at either write leaves neither row and no session. The service now writes the entry through `recordWithin` on that transaction instead of `record`.
- `customer_account.anonymized.v1` erases the account's reason rows and records `impersonation.reasons_erase` with the count. Before, the anonymisation's audit redaction erased the reason with the entry.
- `ADMIN_USERS_AUDIT_KEYS`, a constant in `src/backend/services/impersonation-audit-state.ts` (not on a published barrel), lists every key an impersonation audit state may hold, held by a sentinel test.
- No screen reads the stored reason yet. Audit entries written before the upgrade are not rewritten (owner ruling O-4).

**Behaviour change on upgrade.** See *Impersonation reasons and Organizations leave the platform audit log* in the upgrade guide.
