---
'@endora-commerce/contracts': patch
---

`orgCartDetailPayloadSchema`, `orgCartDetailResponseSchema` and their types `OrgCartDetailPayload` / `OrgCartDetailResponse` are deprecated (issue #657). They never described `GET /api/v1/organization/carts/:id`: the route has never answered the `cartFullPayloadSchema` fields or `auditEntries`, so a real reply fails them. Read the route with `orgCartDetailViewSchema` / `orgCartDetailViewResponseSchema` (types `OrgCartDetailView` / `OrgCartDetailViewResponse`), which the route is typed against since issue #650. The deprecated exports are unchanged and will be removed in the next breaking-change release.
