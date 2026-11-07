---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-customer-accounts': patch
'@endora-commerce/mod-customers': patch
---

The daily anonymization sweep no longer enters the system scope when no account is due, so an idle instance stops writing one `tenant.escape_hatch` audit row a day (issue #857).

- `CustomerAccountLifecycleWritePort` gains `hasDueForAnonymization(cutoff): Promise<boolean>`: whether `listDueForAnonymization(cutoff)` would list anything, answered yes or no over the same predicate. An implementation of the port outside this repository must add it.
- The sweep tick reads `customers.deletion_retention_days` and asks that question before it enters its scope. A question that fails counts as yes, so the sweep then runs as before.
- `CustomerAccountLifecycleWritePort.anonymize` locks the account row before it checks `anonymizedAt`, so two overlapping sweep runs anonymize an account once, with one `customer_account.anonymized` audit entry and one `customer_account.anonymized.v1` event.
