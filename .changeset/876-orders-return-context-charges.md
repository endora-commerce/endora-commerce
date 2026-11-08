---
'@endora-commerce/mod-orders': patch
---

Issue #876 — `OrderReturnContextProvider` (`orderReturnContextPort`) reports the order's `deliveryTotal` and `paymentSurcharge` (the surcharge captured at placement), as stored, so `returns` can refund them on a consumer's withdrawal from the whole order.

**Behaviour change on upgrade.** None in `orders`: it reports two more facts and changes no order. What `returns` does with them is described in the `@endora-commerce/mod-returns` changeset.
