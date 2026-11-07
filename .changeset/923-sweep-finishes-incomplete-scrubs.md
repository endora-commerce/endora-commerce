---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-organizations': minor
'@endora-commerce/mod-customers': patch
---

The customer anonymization sweep now finishes every subject an earlier scrub rule left incomplete (issue #923), not only the accounts never anonymized. Until now it picked its work by account, so a personal organization anonymized before the scrub covered its legal name, order-confirmation e-mails, custom field values or block and rejection reasons kept them for good once its account was done.

`PersonalOrganizationPort` gains `listIncompletelyScrubbed(): Promise<string[]>`: the ids of the personal organizations that carry the scrub's name but not all of the current scrub. It reads only the `organizations` table, ignores the retention cutoff, and agrees field by field with the check `anonymizeIfOrphaned` makes before it writes. An implementation or a test fake of the port must add the method.

Each sweep run now works through the accounts due for anonymization, then the anonymized member of every organization that method lists, each subject once, through the unchanged cascade. Finishing a subject writes one audit entry for each record it changes, keeps the account's `anonymizedAt` and the organization's `deletedAt`, and announces nothing: no second `customer_account.anonymized.v1`, so Forms does not erase the customer's entries a second time. The next run then finds nothing to do. The count `AnonymizationSweepWorker.sweep()` returns is now the number of subjects processed, finished ones included.

The `customers` module page now describes this.
