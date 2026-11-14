---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-quote-requests': minor
'@endora-commerce/mod-projects': patch
---

Issue #457 — a Project with many linked Quote Requests and Opportunities no longer reads them one at a time.

- **`@endora-commerce/contracts`** adds two batched reads to `QuoteRequestReadPort`: `findByIds(ids)`, which answers what `findById` answers for each id in one read (a missing, out-of-scope or malformed id is absent), and `amountsOf(quoteRequestIds)`, a `Map` keyed by quote id holding what `amountOf` answers for each (a quote `amountOf` answers `null` for has no entry). Every implementation of the port must provide both; consumers are unaffected.
- **`@endora-commerce/mod-quote-requests`** implements both under the caller's tenant scope: `findByIds` in one statement, `amountsOf` in two (the quotes, then their lines), whatever the number of ids.
- **`@endora-commerce/mod-projects`** reads a Project's linked Quote Requests through `findByIds` and `amountsOf`, and its linked Opportunities through `OpportunityReadPort.findByIds`, one batch per kind. `GET /api/v1/admin/projects/:id/links` now costs the same number of statements for one linked record of each kind as for many; what it shows is unchanged.
