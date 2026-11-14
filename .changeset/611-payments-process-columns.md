---
'@endora-commerce/mod-payments': patch
'@endora-commerce/mod-payment-methods': patch
'@endora-commerce/platform': patch
---

`payments` now creates `payments.provider_details`, `failure_reason` and `attempt_no` itself, in
the new `Migration20261114T001851PaymentsProcessColumns` (issue #611). Until now only
`payment_methods`' `Migration20260611T140353PaymentMethodsAdapter` created them, although they
belong to `payments`' `Payment` entity. That migration keeps its class name and no longer names
`payments` in `up()` or `down()`. The new migration uses `add column if not exists` with the same
types and default, so a database that has already applied the old migration does not change. Its
`down()` is empty: the `payments` table is created by the platform and its rows outlive the
module. `FIRST_PARTY_FOREIGN_WRITE_EXEMPTIONS` no longer lists `payment_methods` writing
`payments`.
