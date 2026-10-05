---
'@endora-commerce/mod-crm': minor
---

More of the CRM backend, all under `/api/v1/admin/crm`.

**Quote requests and a computed value.**

- `POST /opportunities/:id/links` now takes `"documentKind": "quote_request"`. The quote
  request must belong to the opportunity's organization and to no other opportunity; it is
  listed with its number, status and value. An order placed from a linked quote request is
  linked to the same opportunity by itself (`linkSource: "quote_conversion"`).
- An opportunity in `valueMode: "computed"` carries the sum of its linked orders (at the
  order's gross total) and quote requests (at the net sum of quantity × unit price) whose
  status is a counting status. A document in another currency is left out and listed in
  `excludedDocuments` with `reason: "currency_mismatch"`.
- `PUT /value-counting-statuses` (`crm:configure`) sets which order statuses and quote request
  statuses count, answers **202**, and has every computed opportunity recalculated through the
  new `crm-value-recalculation` queue. Nothing counts until it is set.

**What an instance has to do:** nothing to keep working. A deployment that runs queue workers
gains one consumer, on `crm-value-recalculation`; the package now names `bullmq` and `ioredis`
as peers, which every instance already installs.

**The Quote Requests module is optional for CRM.** It is declared as an edge CRM degrades
without, so an operator can switch the quote desk off while CRM is on: linked quote requests
then show as unavailable and count for nothing, and linking one answers `503 MODULE_DISABLED`.
