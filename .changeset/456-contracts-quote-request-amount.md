---
'@endora-commerce/contracts': minor
---

One rule for what a quote request is worth (issue #456). New `quoteRequestAmountSchema` / `QuoteRequestAmount` — `{ amount, currency, partiallyAgreed }`: per line, quantity × (agreed unit price ?? asked unit price), each line value rounded half up to two places and the values summed; a line with neither price adds nothing; `partiallyAgreed` is `true` while any line has no agreed price. `QuoteRequestReadPort` gains a required `amountOf(quoteRequestId)` answering it, or `null` for a quote the caller cannot see — a structural stub of the port must add it. `quoteRequestSummarySchema` gains optional `amount` and `partiallyAgreed` (admin list rows), and `OpportunityLinkSchema` and `ProjectLinkSchema` an optional `partiallyAgreed`.
