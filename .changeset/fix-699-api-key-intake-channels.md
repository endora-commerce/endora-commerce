---
'@endora-commerce/mod-orders': patch
---

The external order API (`POST /api/v1/external/orders`) now refuses an order whose API-key channel is not one of the bound Organization's active sales channels, with `422 ORDER_SALES_CHANNEL_NOT_ALLOWED` — the rule admin order creation already follows (issue #699). It is checked at placement, so a key keeps working only while its Organization stays assigned to the channel, and nothing is written when it refuses.

**Behaviour change on upgrade.** An existing integration whose Organization is not assigned to its key's channel stops placing orders and gets `422 ORDER_SALES_CHANNEL_NOT_ALLOWED`. Before upgrading, list those keys with the read-only query in *Upgrading an instance* ("API-key orders are placed only on the Organization's channels"). Then either assign the channel to the Organization, or issue a new key bound to one of the Organization's channels and revoke the old one.
