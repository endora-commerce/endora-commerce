---
title: quote_requests
---

# `quote_requests`

The RFQ lifecycle. A Customer drafts a Quote Request, submits it, a Supplier
employee claims and sends a quote, the Customer accepts or rejects, and the
RFQ either converts to an Order or expires.

## Public surface

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/quote-requests/current` | customer | Get / lazy-create the open draft |
| `POST /api/v1/quote-requests/current/items` | customer | Add line item |
| `POST /api/v1/quote-requests/current/submit` | customer | Submit draft → `new` |
| `POST /api/v1/quote-requests/:id/accept` | customer | Accept a `quoted` RFQ → `accepted` |
| `POST /api/v1/admin/quote-requests/:id/claim` | admin | Lock RFQ to a single employee |
| `POST /api/v1/admin/quote-requests/:id/quote` | admin | Send a quote with terms + expiry |

## State machine

`draft → new → in_review → quoted → (accepted | rejected | expired)`.
Transitions are enforced inside `rfq-service.ts` and `rfq-admin-service.ts`;
invalid transitions return `409 INVALID_TRANSITION`.

## Entities

`QuoteRequest`, `QuoteRequestItem`, plus an embedded `QuoteTerms` value
object. A partial unique index `(organization_id, customer_account_id) WHERE
status='draft'` keeps each Customer to one open draft.

## Events emitted

`rfq.created.v1`, `rfq.submitted.v1`, `rfq.quoted.v1`, `rfq.accepted.v1`,
`rfq.rejected.v1`, `rfq.expired.v1`.

## Extension points

- **Expiry policy** — `rfq-expiry-worker.ts` is a BullMQ repeatable; change
  the cadence or grace window there.
- **Quote → Order conversion** — `convertToOrder()` in `rfq-service.ts`
  delegates to the `orders` module; new pre-conversion validation hooks
  belong here.
