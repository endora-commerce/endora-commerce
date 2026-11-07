---
'@endora-commerce/mod-inventory': patch
---

The back-in-stock e-mail is no longer sent for a product that is not for sale (issue #468). When stock rises from zero, the fan-out reads the product once and checks its global state before mailing anyone. A deleted or missing product cancels its queued subscriptions. An archived product, a globally `inactive` one, or one outside its global publication window sends nothing and keeps the subscriptions queued, so they are notified at a later restock once the product is for sale again. Both send paths apply the check: `AvailabilityWorker.dispatchForStockIncrease` and `AvailabilityNotificationService.processRestockedFanOut`. Per-channel, per-language and per-audience availability is not checked yet, and the e-mail still names the product by its global name.
