---
'@endora-commerce/mod-quote-requests': minor
---

A quote request that a customer orders is now completed by that order.

`POST /api/v1/quote-requests/:id/convert-to-order` has always seeded the basket at the agreed
prices; it now also marks the basket with the quote request, so the order placed from it
records `sourceQuoteRequestId` (see `@endora-commerce/mod-orders`). The module's existing
`order.created.v1` subscriber — which sets `Completed`, `converted_order_id` and sends the
`completed` notification — had nothing to react to until now, so **on upgrade, accepted quote
requests start being completed when they are ordered, and a completed one can no longer be
converted a second time** (`409 RFQ_NOT_QUOTED`). Quote requests ordered before the upgrade
stay `Approved`; nothing is backfilled.

Two changes to that subscriber:

- It waits for the order's commit. The event is announced from inside the placing
  transaction, so the order is sometimes not readable yet; the subscriber now looks again —
  off the event bus, for a little over two seconds — instead of giving up at the first read.
- It never completes a quote request for an order of another organization.

**Breaking for anyone composing `quoteRequestsModule(...)` by hand**: `QuoteRequestsModuleOptions`
gains two required members, `deferAfterCommit(work)` and `isStillPresent()`. The packaged
composition (`registerModule`) supplies both.

The response of `convert-to-order` is unchanged, and so is every other route.
