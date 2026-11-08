---
'@endora-commerce/mod-customers': patch
---

The retention sweep erases the anonymised customer's audit history in place, through the platform's `auditRedactionService` (issue #844). This covers the rows about the account, and for an individual also the rows about their personal Organization, every address of it (deleted ones included) and the account's rows in the retired personal address book. Keys, ids, timestamps, codes, actions, actors and times stay. Personal values, free text and every custom-field value become `"[erased]"`, and so do the IP address and user agent on the rows the customer wrote for themselves. One `audit.redacted` entry is written per subject. The step runs after the organisation and address scrubs and before the account's own scrub, so an interrupted run is finished by the next one. `CustomerDeletionService` takes the history step's dependencies as a ninth constructor argument, and the module reads `auditRedactionService` off its cradle.
