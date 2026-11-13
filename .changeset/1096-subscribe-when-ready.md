---
'@endora-commerce/platform': patch
'@endora-commerce/mod-custom-fields': patch
'@endora-commerce/mod-price-lists': patch
---

Cross-process cache subscribers no longer send `SUBSCRIBE` while their ioredis client is still in its handshake (issue #1096). In the `connect` state ioredis wrote the command straight to the socket; when its reply arrived before the ready check's `INFO`, ioredis refused that `INFO`, re-opened the connection, and a message published during the reconnect was lost. The new `subscribeWhenReady(client, ...channels)` in `@endora-commerce/platform/kernel` (with its structural type `HandshakeAwareSubscriber`) waits out the handshake and then subscribes. It rejects as `subscribe` does, including when the client ends mid-handshake. The module-registry cache, the sales-channel access cache, the `custom_fields` definition cache and the `price_lists` pricing generation now subscribe through it. The cradle type `PricingGenerationSubscriber` in `price_lists` now extends `HandshakeAwareSubscriber`, so it also requires `status`, `once` and `removeListener`. The composition's ioredis subscriber already has them. Nothing else changes for a caller.
