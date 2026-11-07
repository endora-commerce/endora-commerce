---
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-customer-accounts': patch
'@endora-commerce/mod-customers': patch
'@endora-commerce/contracts': patch
---

The customer anonymization sweep now erases the reasons operators wrote about the customer (issue #843). `PersonalOrganizationPort.anonymizeIfOrphaned` sets a personal organization's `blockedReason` and `rejectedReason` to `null`; `CustomerAccountLifecycleWritePort.anonymize` sets the account's `blockReason` to `null`. The block or rejection itself is kept: the status, `blockedAt`, `rejectedAt`, `blockSource` and who applied the block. A company organization keeps its reasons.

The audit entries record only whether a reason existed: `organization.anonymized` gains `stateBefore.hadBlockedReason` and `stateBefore.hadRejectedReason`, and `customer_account.anonymized` gains `stateBefore.hadBlockReason`. None of them stores the reason text.

A subject anonymized by an earlier release is finished on the next sweep run. `CustomerAccountLifecycleWritePort.listDueForAnonymization` now also lists an anonymized account that still has a block reason or custom field values (left by a scrub before #802), whatever the retention cutoff, so raising `customers.deletion_retention_days` cannot strand it. For such an account, `anonymize` clears what is left and writes one more `customer_account.anonymized` entry. That entry's `stateBefore.anonymizedAt` is the original anonymization time, where the first scrub's is `null`; `hadBlockReason` and `customFieldKeys` say what was left. It keeps `anonymizedAt` and does not announce `customer_account.anonymized.v1` again. A personal organization with a reason left is finished whenever the sweep reaches its account.

The `customers` module page now describes this, and says that audit entries written earlier keep the reason they recorded until #844 ships.
