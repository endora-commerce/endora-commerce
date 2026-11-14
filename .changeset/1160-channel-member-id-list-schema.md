---
'@endora-commerce/contracts': minor
---

New export `ChannelMemberIdListResponseSchema` (type `ChannelMemberIdListResponse`) describes what `GET /api/v1/admin/sales-channels/{code}/{entityType}` answers: `{ salesChannelCode, entityType, entityIds: uuid[], page, pageSize, total }`, unwrapped, with a 0-based `page` (issue #1160). `ChannelMembershipListResponseSchema` and `ChannelMembershipListResponse` are deprecated and unchanged: their `{ channels }` shape never described that route, and its comment no longer claims it. `ChannelMemberIdListResponseSchema` / `ChannelMemberIdListResponse` replace them; the deprecated pair is removed in the minor release after this one (issue #1162).
