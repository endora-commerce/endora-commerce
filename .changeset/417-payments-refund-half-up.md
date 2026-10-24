---
'@endora-commerce/mod-payments': patch
---

`reflectRefund` stores the gateway's cumulative refunded amount half-up on its decimal digits (issue #417); `toFixed(2)` rounded the double, so 1.005 was stored as 1.00.
