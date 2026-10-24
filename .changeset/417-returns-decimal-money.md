---
'@endora-commerce/mod-returns': patch
---

Refund amounts are computed in exact decimal arithmetic (issue #417). An approved amount is rounded half-up on its decimal digits (new `approvedAmount`) before it is capped, summed and stored: a typed 1.005 was the refund 1.00. `exceedsCap` compares the amount at the two places it would be stored at, so 100.005 against a 100.00 cap is refused, where the half-cent tolerance on doubles let it through; `defaultRefundForQuantity` and `sumApproved` are exact. A return delivery method's `returnCost` is stored half-up.
