---
'@endora-commerce/contracts': minor
---

Issue #1270 — `quoteRequestSummarySchema` declares the optional `statusName`: a row's status named in the response language, which each row of `GET /api/v1/admin/quote-requests` has carried since issue #455 for another module's link picker. A strict parse of an admin list row with the published schema refused the key. Admin list only; the buyer list does not send it.

**On upgrade.** Nothing to migrate. `QuoteRequestSummary` gains the optional `statusName: string`.
