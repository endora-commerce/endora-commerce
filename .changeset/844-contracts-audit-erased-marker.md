---
'@endora-commerce/contracts': minor
---

New `AUDIT_ERASED_MARKER` (`'[erased]'`), the stored value of an audit-snapshot field erased when its subject was anonymised, and four owner-declared lists of the code keys a redacted audit row keeps for an object type: `CUSTOMER_ACCOUNT_AUDIT_KEEP_KEYS`, `ORGANIZATION_AUDIT_KEEP_KEYS`, `ADDRESS_AUDIT_KEEP_KEYS` and `CUSTOMER_ADDRESS_AUDIT_KEEP_KEYS`. Additive; nothing existing changes.
