---
'@endora-commerce/mod-addresses': minor
---

Issue #470 (D-288) — Organization address audit entries carry names, never values. An `Address` is `@OrgScoped`, and the platform audit log is read under `audit_log:read` without Organization reach.

- `address.create`, `address.update`, `address.delete` and `address.anonymized` no longer record the Organization's id (the tenant anchor). The entries are still recorded against the address (`objectId`).
- `address.create` records `{ kind, changedFields }`, the sorted names of the fields the address was created with. `address.update` records `{ kind, changedFields }` naming only the fields whose value changed; it used to record no change at all. Neither records the recipient, street, city, postal code or phone, as before.
- `ADDRESS_AUDIT_KEYS`, a constant beside the snapshot helpers in `src/backend/services/address-audit-state.ts` (not on a published barrel), lists every top-level key an address audit state may hold, held by a sentinel test.
- No address screen reads values back from the audit log, so no value store is added.
- Audit entries written before the upgrade are not rewritten (owner ruling O-4).

**Behaviour change on upgrade.** A report that found an Organization's address entries by `stateBefore.organizationId` / `stateAfter.organizationId` filters by the address ids instead. See *Organization addresses leave the platform audit log* in the upgrade guide.
