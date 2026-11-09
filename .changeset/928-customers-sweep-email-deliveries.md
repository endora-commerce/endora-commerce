---
'@endora-commerce/mod-customers': patch
---

The retention sweep now scrubs the delivery records of the e-mails sent to the anonymised account's address, through `email`'s `emailDeliveryAnonymizationPort`, after the carts step and before the history is erased and the account's own scrub, so an interrupted run is finished by the next one (issue #928). A subject that is already anonymised is not handed to the step: its address is already the account's marker. `CustomerDeletionService` takes the port as a new constructor argument after the carts port, and `CustomersModuleOptions` gains `emailDeliveryAnonymizationPort`.
