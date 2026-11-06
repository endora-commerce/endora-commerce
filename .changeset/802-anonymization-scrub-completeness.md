---
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-customer-accounts': patch
'@endora-commerce/contracts': patch
---

The customer anonymization sweep now clears every field that can hold the person's data (issue #802). On a personal organization, `PersonalOrganizationPort.anonymizeIfOrphaned` also sets `legalName` to `null`, empties `orderConfirmationEmails` (so `orders` stops mailing those addresses) and clears all custom field values. A personal organization scrubbed by an earlier release is finished on the next sweep run. On the account, `CustomerAccountLifecycleWritePort.anonymize` also clears all custom field values.

`CustomerAccountLifecycleWritePort.anonymize` now writes the scrub and its `customer_account.anonymized` audit entry in one transaction, and announces `customer_account.anonymized.v1` only after that commit. Before, the audit entry was written after the scrub had committed, so a crash between the two left an anonymized account with no audit entry.

The two audit entries no longer store the data they erase. `customer_account.anonymized` no longer has `stateBefore.email`; its `stateBefore` is `{ anonymizedAt: null }`. `organization.anonymized` no longer has `stateBefore.name`; its `stateBefore` records `wasDeleted`, `hadLegalName`, `orderConfirmationEmailCount` and `customFieldKeys` (the sorted keys that held a value).
