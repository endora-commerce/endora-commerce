---
'@endora-commerce/contracts': minor
---

More typed money fields refuse more than two decimal places with `400 AMOUNT_PRECISION_EXCEEDED` (issue #417, owner ruling of 2026-10-24), instead of being rounded: `deliveryMethodUpsertSchema.cost`, `paymentMethodUpsertSchema.additionalPrice`, `returnDeliveryMethodCreateSchema.returnCost` and `returnDeliveryMethodUpdateSchema.returnCost`, `settlementRequestSchema.lines[].approvedRefundAmount`, `adminOrderRefundRequestSchema.amount`, `grantCreditLimitRequestSchema.grantedAmount` and `adjustCreditLimitRequestSchema.grantedAmount`, and an ERP integration's decimal strings in `erpSaleDocumentUpsertInputSchema` (`netTotal`, `taxTotal`, `grossTotal`, `paidTotal`).
