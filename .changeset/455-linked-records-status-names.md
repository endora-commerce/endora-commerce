---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-crm': minor
'@endora-commerce/mod-quote-requests': minor
'@endora-commerce/mod-projects': patch
---

Issue #455 — a Project's *Linked records* tab and its link picker name each record's status the way the record's own module names it, in the reader's language, instead of showing the stored code (`new`, `proposal`, `Pending`).

- **`@endora-commerce/contracts`** adds `statusName(code, language)` to `OpportunityReadPort` and `statusName(status, language)` to `QuoteRequestReadPort`, each answering a `Promise<string>`, and the optional `statusName` to `ProjectLinkSchema` beside `status`. A test double that implements either port in full needs the new method.
- **`@endora-commerce/mod-crm`** implements `OpportunityReadPort.statusName` by its own rule: the configured name in that language, else the status's default name, else the code.
- **`@endora-commerce/mod-quote-requests`** implements `QuoteRequestReadPort.statusName` in the wording its global-search results already use (a code outside the six statuses answers as it is), and each row of `GET /api/v1/admin/quote-requests` now also carries `statusName` in the response language.
- **`@endora-commerce/mod-projects`** serves `statusName` on `GET` and `POST /api/v1/admin/projects/:id/links` (an Order's name from `orderReadPort.findStatusDefinition`), and the admin tab and picker show it.

**On upgrade.** Nothing to migrate; `status` keeps answering the code.
