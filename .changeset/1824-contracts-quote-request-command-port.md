---
'@endora-commerce/contracts': minor
---

New `QuoteRequestCommandPort` (issue #1824, container name `quoteRequestCommandPort`, owner `quote_requests`): the QuoteRequest aggregate's write port for server-side code — `create`, `update`, `setCustomFieldValues`, `assign`, `approve`, `cancel` and `sendDocument`. Each takes the matching admin route's body type (`AdminCreateQuoteRequest`, `AdminPatchQuoteRequest`, `AdminApproveQuoteRequest`, `QuoteRequestPdfSendRequest`, …) and answers a `QuoteRequestRecord` (`sendDocument`: a `QuoteRequestPdfSendResult`). The buyer's own transitions are deliberately not on it.

Also new, shared by every aggregate write port (`specs/186-aggregate-ports/`): `AggregateCommandOptions` — the optional last parameter, with `extensions`, `expectedVersion` and `source` — the `aggregateCommandSourceSchema` a `source` code must match, and `CustomFieldMerge`, the read-modify-write a `setCustomFieldValues` takes.

`RfqCreatedByAdminEventPayload.adminUserId` widens from `string` to `string | null`: `rfq.created_by_admin.v1` names no administrator when a worker creates the quote through the port under `withSystemScope`. A subscriber that reads `adminUserId` handles `null`.
