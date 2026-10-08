---
'@endora-commerce/mod-quote-requests': minor
---

Two additive seams for other modules; an instance in which nobody uses them behaves as before.

- **A new in-process event, `rfq.created_by_admin.v1`** (`rfqId`, `organizationId`,
  `adminUserId`, `origin | null`), emitted once per quote request created through
  `POST /api/v1/admin/quote-requests`, which accepts an optional opaque `origin: { type, id }`
  and hands it on unread. `rfq.created.v1` is still emitted for a customer's own submission
  only, so nothing that listens to it starts seeing requests an administrator prepared.
- **The create screen (`/quote-requests/new`) can be opened by another screen**: it reads
  `originType`, `originId`, `organizationId`, `customerAccountId` and `returnTo` from its query
  string. Opened without them it behaves as before.
- **A new admin zone, `quote_request.detail.after`**, mounted once at the end of a quote
  request's screen with `{ quoteRequestId }`. The module names no contributor; with nothing
  contributed the screen is unchanged.
