---
"@endora-commerce/mod-orders": minor
"@endora-commerce/contracts": minor
---

Orders can name a related payer. `placeOrderRequestSchema` and the preview request accept an optional `payerOrganizationId`; with it, billing address, billing company data, tax, the payment-method allow-list and the credit reservation follow the payer, while the order stays the buyer's. Sending it together with a billing company override is refused (`400 VALIDATION_FAILED`, issue `PAYER_BILLING_OVERRIDE_CONFLICT` = `payer_billing_override_conflict`). Orders carry `payer` (`orderPayerSchema`, `null` when the buyer pays), the admin order list accepts `?payerOrganizationId=` and the admin screens show and filter the payer. `OrderReturnContext` gains an optional `payerOrganizationId`. New port `paidOrderReadPort` (`PaidOrderReadPort`, `paidOrderSummarySchema`, `paidOrderDetailSchema`) serves the payer's read-only view. A new migration adds the payer columns to `orders`. Without `related_payers` an order naming a payer is refused; every other order is unaffected.
