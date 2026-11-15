---
'@endora-commerce/mod-customers': minor
---

Issue #470 (D-288) — the retired personal address book's audit entries carry names, never the tenant anchor. A `CustomerAddress` is `@CustomerScoped`, and the platform audit log is read under `audit_log:read` without Organization reach.

- `customer_address.merge`, `customer_address.merge_refused`, `customer_address.erased` and `customer_address.anonymized` no longer record the customer account's id in `stateBefore`; it now holds `{ kind }` (plus `wasDeleted` for `.anonymized`). The entries are still recorded against the row (`objectId`).
- `customer_address.merge` and `.merge_refused` no longer record the personal Organization's id. A merge keeps `mergedIntoAddressId`, `deduplicated` and `wasDefault`; a refusal keeps `mergeRefusal`, the owner's error code. None of them records an address value, as before.
- `CUSTOMER_ADDRESS_AUDIT_KEYS`, a constant in `src/backend/services/customer-address-audit-state.ts` (not on a published barrel), lists every top-level key these states may hold, held by a sentinel test.
- No screen reads these values back from the audit log, so no value store is added. The retention sweep's audit-history erasure finds the entries by row id and is unaffected.
- Audit entries written before the upgrade are not rewritten (owner ruling O-4).

**Behaviour change on upgrade.** See *Retired personal address book entries leave out the account and the Organization* in the upgrade guide.
