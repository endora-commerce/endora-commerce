---
'@endora-commerce/mod-orders': minor
---

`OrderReturnContextPort.getReturnContext` reports the order's `paymentMethodId` (#905), so the refund of a consumer's withdrawal can propose the order's own payment method. Additive: nothing else in the context changes.
