---
'@endora-commerce/platform': patch
---

`AuditRedactionPort.redact` now finishes a target with more than 1,000 ids in one call: it looks the target's rows up 1,000 object ids at a time and still writes exactly one `audit.redacted` row per call (issue #959). Before, a subject with more than 1,000 addresses, in its personal organisation or in the retired personal book, was refused on every retention-sweep tick and never anonymised. `AUDIT_REDACTION_MAX_IDS_PER_TARGET` (`@endora-commerce/platform/kernel`) is now 10,000, a sanity limit rather than a batch size; a target above it is still refused. No other signature changes.
