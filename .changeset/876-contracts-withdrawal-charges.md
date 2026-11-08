---
'@endora-commerce/contracts': minor
---

Issue #876 — the shapes a consumer's withdrawal needs to refund the delivery cost and the payment surcharge (Directive 2011/83/EU art. 13(1)). On the wire every field is additive:

- `settlementRequestSchema` takes optional `deliveryRefundAmount` and `surchargeRefundAmount` (two places, non-negative).
- `settlementPrefillSchema` gains optional `charges: { delivery?, surcharge? }`, each a `settlementChargeSchema` (`{ cap, approved }`; `SettlementCharge`).
- `returnCaseDetailSchema` gains optional `chargeRefunds: { delivery, surcharge }`.
- `CorrectiveInvoiceInput` takes optional `charges: { delivery?, surcharge? }`, gross amounts that `total` includes.

Two port interfaces gain required members, so an implementation outside this repository has to add them. `OrderReturnContext` gains `deliveryTotal` and `paymentSurcharge` (two-place decimal strings, as stored; `orders` implements it). `ReturnRefundReadPort` gains `listRefundedCharges(orderId): Promise<OrderRefundedCharges>` (`{ delivery, surcharge }`; `returns` implements it).

**Behaviour change on upgrade.** None from the schemas alone. A client that reads `SettlementResult.totalRefundAmount` or a case's `totalRefundAmount` as the sum of the lines' approved amounts is wrong for a B2C case that completes a withdrawal: from this release that total also includes the delivery and the surcharge refunded (see `@endora-commerce/mod-returns`).
