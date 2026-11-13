---
'@endora-commerce/mod-sales-channels': patch
---

Sales-channel admin replies are typed by their contract (issue #599, section 6). `serializeSummary` and `serializeDetail` return the contract's `SalesChannelSummary` and `SalesChannelDetail` instead of `Record<string, unknown>`. The list, detail, create, update, activate, deactivate and set-default handlers declare `SalesChannelListResponse`, `SalesChannelDetail` and `SalesChannelSetDefaultResponse`. The entity-side membership list (`GET /api/v1/admin/sales-channels/by-entity/:entityType/:entityId`) builds its rows with `serializeSummary` and returns `EntityMembershipListResponse`. The admin membership panel and the admin client use that contract type instead of a hand-written copy. Nothing on the wire changes.
