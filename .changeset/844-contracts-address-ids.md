---
'@endora-commerce/contracts': minor
---

`ORGANIZATION_AUDIT_KEEP_KEYS` now also keeps `orderConfirmationEmailCount`, the count the `organization.anonymized` entry records, so the sweep's redaction leaves the entry it has just written as it was.
