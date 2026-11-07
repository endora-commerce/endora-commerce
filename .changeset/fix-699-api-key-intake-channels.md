---
'@endora-commerce/mod-orders': patch
---

The external order API (`POST /api/v1/external/orders`) now refuses an order whose API-key channel is not one of the bound Organization's active sales channels, with `422 ORDER_SALES_CHANNEL_NOT_ALLOWED` — the rule admin order creation already follows (issue #699). It is checked at placement, so a key keeps working only while its Organization stays assigned to the channel, and nothing is written when it refuses. An integration whose Organization is not assigned to its key's channel has to be assigned before it can place orders again.
