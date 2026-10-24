---
'@endora-commerce/mod-delivery-methods': patch
'@endora-commerce/mod-payment-methods': patch
---

A delivery method's `cost` and a payment method's `additionalPrice` are stored at two places half-up on their decimal digits (`roundHalfUp` from `@endora-commerce/contracts`, issue #417). `toFixed(2)` rounded the binary double: a typed 1.005 was stored as 1.00 and 2.675 as 2.67.
