---
'@endora-commerce/mod-projects': patch
'@endora-commerce/contracts': patch
---

`projectCommandPort.setOrganizations` and `.setMembers` called without `expectedVersion` now hold the `configurationVersion` their own read saw (issue #1986). A set another caller committed between that read and the write is refused `409 PROJECT_CHANGED`, where before the Organizations diff computed from the stale read was merged into it (a caller who read {X} and asked for {X, Y} after another set {Z} left {Y, Z}). Reload the record and retry on that refusal, as with a stale `expectedVersion`.

The admin routes `PUT /api/v1/admin/projects/:id/organizations` and `…/members` are unchanged: without `configurationVersion` in the body they are not checked.

`ProjectCommandPort`'s JSDoc (`@endora-commerce/contracts`) now says what an absent `expectedVersion` holds, and names a second call on which an unclaimed `extensions` key is not refused: an `update` with an empty patch, which runs no Command.
