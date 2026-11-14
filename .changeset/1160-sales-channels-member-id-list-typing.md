---
'@endora-commerce/mod-sales-channels': patch
---

The channel-side membership list handler (`GET /api/v1/admin/sales-channels/:code/:entityType`) declares its reply as the contract's `ChannelMemberIdListResponse`, and the admin client's `listEntitiesInChannel` returns `Promise<ChannelMemberIdListResponse>` instead of a hand-written inline type (issue #1160). Nothing on the wire changes.
