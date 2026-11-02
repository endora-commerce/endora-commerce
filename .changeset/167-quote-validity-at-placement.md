---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-carts': minor
'@endora-commerce/mod-orders': minor
'@endora-commerce/mod-quote-requests': patch
---

A quote's validity date now binds order placement, not only the conversion into a basket (issue #167). A basket line filled by `convert-to-order` names its quote (`CartItemRecord.quoteRequestId`, column `cart_items.quote_request_id`, backfilled from the basket's `source_quote_request_id`), and placement refuses every line still priced at its agreement with `410 QUOTE_VALIDITY_ENDED` once that quote's `expiresAt` has passed (`details.code: 'lapsed'`), once it no longer applies — re-opened, cancelled, expired or gone (`'withdrawn'`) — or while `quote_requests` is off and nothing can confirm the prices (`'unavailable'`, fail-closed; this used to place the basket at the agreed prices). The order-total preview answers the same verdict as `quoteCommitmentRefusal` (`quoteCommitmentRefusalSchema` in `@endora-commerce/contracts`), `null` when nothing is refused. `QUOTE_VALIDITY_ENDED` declares the three reasons as refusal tokens, with sentences in English and Polish.
