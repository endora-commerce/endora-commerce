---
'@endora-commerce/mod-quick-order': minor
---

Issue #470 (D-288) — a default ordering preference's audit entry no longer names the tenant. The preference row is `@GlobalEntity`, but each one is about an Organization or a customer account, and the platform audit log is read under `audit_log:read` without Organization reach (`specs/conventions/audit-state.md` §5).

- `quick_order.default_preference.update` no longer records `scopeId` (the Organization's or the customer account's id) in `stateBefore` / `stateAfter`. It keeps `scope` and the ids of the chosen payment method, delivery method and addresses; `stateAfter` adds `changedFields`, the sorted names of the fields whose value changed. The entry is still recorded against the preference row (`objectId`).
- `QUICK_ORDER_AUDIT_KEYS`, a constant in `src/backend/services/default-preference-audit-state.ts` (not on a published barrel), lists every top-level key the state may hold, held by a sentinel test.
- No screen reads values back from the audit log, so no value store is added. Audit entries written before the upgrade are not rewritten (owner ruling O-4).

**Behaviour change on upgrade.** See *Default ordering preferences leave the Organization and the account out of the audit log* in the upgrade guide.
