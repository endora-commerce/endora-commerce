---
'@endora-commerce/contracts': minor
---

Breaking: `ChannelMembershipListResponseSchema` and its type `ChannelMembershipListResponse`, deprecated in 0.111.0 (issue #1160), are removed (issue #1162). Their `{ channels }` shape never described `GET /api/v1/admin/sales-channels/{code}/{entityType}`. Import `ChannelMemberIdListResponseSchema` and `ChannelMemberIdListResponse` instead: they describe what that route answers, `{ salesChannelCode, entityType, entityIds, page, pageSize, total }`, with a 0-based `page`. The entity-side list of an entity's channels stays `EntityMembershipListResponseSchema`.
