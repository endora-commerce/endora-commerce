---
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/contracts': minor
---

The quote request list's `totalAtCustomerPrice` and `totalAtAgreedPrice` are exact sums (issue #417, review of PR #423): 3 × 9.05 was published as `27.150000000000002`, now `27.15`. A typed `desiredUnitPrice` (`createQuoteRequestLineSchema`) and `agreedUnitPrice` (`adminCreateQuoteRequestLineSchema`, `adminPatchQuoteRequestLineSchema`) with more than two decimal places is refused with `400 AMOUNT_PRECISION_EXCEEDED` (`@endora-commerce/contracts`).
