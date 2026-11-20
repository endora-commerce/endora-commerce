---
"@endora-commerce/mod-carts": minor
"@endora-commerce/contracts": minor
---

Carts can be bought for a related payer on the payer's commercial terms. New route `PUT /api/v1/cart/buying-for` (`setCartBuyingForRequestSchema`, `setCartBuyingForResponseSchema` with a `cartRepricingSummarySchema`) reprices the active cart — prices, line VAT and promotions — for the payer. The cart payload carries `buyingFor` and `buyingForReset` (both `null` by default); a cart read resets a context whose link is no longer usable. A new migration adds `buying_for_organization_id` and `buying_for_terms` to `carts`. Without `related_payers` no payer can be chosen and nothing changes.
