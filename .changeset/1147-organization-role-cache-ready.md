---
'@endora-commerce/mod-organizations': patch
---

The organization-role cache no longer sends `SUBSCRIBE` while its ioredis subscriber connection is still in its handshake (issue #1147, a follow-up to #1096). `OrganizationRoleCache.start` now subscribes through `subscribeWhenReady` from `@endora-commerce/platform/kernel`, as the module-registry, sales-channel access, custom-field definition and pricing generation caches already do, so a role-change announcement published during boot is no longer lost to a forced reconnect. The structural type `OrganizationRoleSubscriber` now extends `HandshakeAwareSubscriber`, so it also requires `status`, `once` and `removeListener`; the composition's ioredis subscriber already has them.
