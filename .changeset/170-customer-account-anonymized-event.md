---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-customer-accounts': minor
---

`customer_account.anonymized.v1`: a customer account's anonymisation is announced once.

- `@endora-commerce/contracts`: `CUSTOMER_ACCOUNT_ANONYMIZED_EVENT` (`'customer_account.anonymized.v1'`), `CustomerAccountAnonymizedEventV1Schema` and `CustomerAccountAnonymizedEventV1` — `{ eventId, occurredAt, customerAccountId, organizationId }`, strict, ids only.
- `@endora-commerce/mod-customer-accounts`: `CustomerAccountLifecycleWritePort.anonymize` emits it on the in-process event bus after its write and its audit row, on the transition only — anonymising an account that is already anonymised emits nothing. A module holding data attributed to the account can erase it in the same step. The event is not offered to outbound webhooks. `CustomerAccountLifecycleWriteService` takes an optional sixth constructor argument, the emit callback; a service built without it announces nothing.
