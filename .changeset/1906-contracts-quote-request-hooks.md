---
'@endora-commerce/contracts': minor
---

**`quote_requests` declares the buyer's two submissions hookable** (issue #1906): `QUOTE_REQUEST_HOOKABLE_ACTIONS.create` (`quote_request.create`, the buyer's create — which is the submission) and `QUOTE_REQUEST_HOOKABLE_ACTIONS.resubmit` (`quote_request.resubmit`, *Submit again*), object type `quote_request`, each for both phases (`beforeCommit` inside the write's transaction, with a veto that rolls it back; `afterCommit` through the platform's outbox).

New types: `QuoteRequestCreateOutbox` — `quoteRequestId`, `organizationId` (also the row's routing), `customerAccountId`, `salesChannelId`, `assignedAdminUserId` and `itemCount`, ids and counts only — and `QuoteRequestResubmitOutbox`, the same plus `sourceQuoteRequestId`. Their `beforeCommit` data, `QuoteRequestCreateHookData` and `QuoteRequestResubmitHookData`, add `QuoteRequestAssignInWrite`'s `assign(adminUserId)`, through which a hook makes an administrator the new request's assignee inside the write.

New error code `RFQ_ASSIGNEE_NOT_ELIGIBLE` (422, owned by `quote_requests`, token `submission`): the administrator named as a quote request's assignee is not active, does not hold `rfqs:handle` or does not reach the request's Organization. `QuoteRequestCommandPort.assign` now answers it for such a target; its JSDoc says so, and that its actions are not the hookable ones.
