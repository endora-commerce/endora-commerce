---
'@endora-commerce/contracts': minor
---

One rule for what a quote request is worth (issue #456).
- New `quoteRequestAmountSchema` / `QuoteRequestAmount`, shaped `{ amount, currency, agreement }`:
  - the amount is per line, quantity × (agreed unit price ?? asked unit price); each line value is rounded half up to two places and the values are summed;
  - a line with neither price adds nothing, and `amount` is `null` when no line has a price;
  - `agreement` (`quoteRequestAgreementSchema`) is `agreed`, `partial` or `none`.
- `QuoteRequestReadPort` gains a required `amountOf(quoteRequestId)` that returns it, or `null` for a quote the caller cannot see. A structural stub of the port must add it.
- `quoteRequestSummarySchema` gains optional `amount` and `agreement` (admin list rows).
- `OpportunityLinkSchema` and `ProjectLinkSchema` gain an optional `agreement`.
