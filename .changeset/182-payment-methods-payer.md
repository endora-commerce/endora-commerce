---
"@endora-commerce/mod-payment-methods": minor
---

`GET /api/v1/payment-methods` accepts `?payerOrganizationId=`: once `related_payers` vouches that the buyer may use that payer, the payer's payment-method allow-list applies instead of the buyer's. While `related_payers` is off such a request answers `503 MODULE_DISABLED`; every other listing is unaffected.
