---
'@endora-commerce/mod-customers': patch
---

The retention sweep now erases the reasons operators and approvers gave for rejecting the anonymised account's carts, through `carts`' `cartAnonymizationPort`, before the account's own scrub, so an interrupted run is finished by the next one (issue #920). `CustomerDeletionService` takes the port as a ninth constructor argument, and `CustomersModuleOptions` gains `cartAnonymizationPort`.
