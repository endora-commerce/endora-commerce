---
'@endora-commerce/mod-quote-requests': patch
---

**A quote request is accepted, approved and ordered only once the seller has priced it.**

A quote line is sold at the unit price the seller agreed, and a line the seller has not priced has
no price at all. Three operations now hold that rule, and each answers `409` when it is not met:

- `POST /api/v1/quote-requests/:id/accept-revision` answers `RFQ_NOT_QUOTED` when the seller has
  made no offer to accept — the request is neither `Created from admin` nor awaiting the customer's
  acceptance of a seller revision — and `QUOTE_INCOMPLETE` when the seller's offer leaves a line
  without an agreed unit price.
- `POST /api/v1/admin/quote-requests/:id/approve` answers `QUOTE_INCOMPLETE` while any line has no
  agreed unit price. An operator who wants to approve a request as the customer raised it prices
  every line first (`PATCH /api/v1/admin/quote-requests/:id`), then approves.
- `POST /api/v1/quote-requests/:id/convert-to-order` answers `QUOTE_INCOMPLETE` while any line has
  no agreed unit price, whichever way the request came to be approved.

`QUOTE_INCOMPLETE` was already one of the module's declared error codes and nothing raised it; it
and `RFQ_NOT_QUOTED` now carry a real sentence in English and Polish in place of the generated
placeholder.

What an instance should expect:

- The rules are about a **missing** price. An agreed unit price of exactly `0` that an operator
  entered is an agreed price like any other, and such a request is accepted, approved and ordered
  as before.
- `reject-revision` is unchanged: a customer can still withdraw a request the seller has not
  answered.
- **A request that is already `Approved` with an unpriced line can no longer be converted into an
  order — that is intended.** Its lines cannot be edited in that status, so the way forward is
  `resubmit`, which raises a new request for the seller to price. To find them:

  ```sql
  select distinct qr.id, qr.business_id
    from quote_requests qr
    join quote_request_items it on it.quote_request_id = qr.id
   where qr.status = 'Approved' and it.agreed_unit_price is null;
  ```

- Orders already placed are not touched. An order placed from such a request before this release
  carries the unit price it was placed at; the same query with `qr.status = 'Completed'` lists the
  requests to review.
