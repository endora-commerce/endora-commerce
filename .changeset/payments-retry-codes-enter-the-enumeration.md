---
'@endora-commerce/contracts': minor
---

`ERROR_CODES` gains `PAYMENT_NOT_DUE`, `PAYMENT_ORDER_CLOSED` and
`PAYMENT_ADAPTER_UNAVAILABLE`, the three codes `@endora-commerce/mod-payments`
declares for the buyer's payment-retry refusals.

Additive: no existing member changes and no consumer breaks. A consumer that
switches exhaustively over `ErrorCode` gains three members to handle.
