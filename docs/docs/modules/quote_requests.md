---
title: quote_requests
---

# `quote_requests`

The RFQ lifecycle. A Customer drafts a Quote Request, submits it, a Supplier
employee claims and sends a quote, the Customer accepts or rejects, and the
RFQ either converts to an Order or expires.

## Public surface

Admin routes are gated by `rfqs:handle`. ETags on draft routes give the
customer a `If-Match` optimistic-concurrency hook.

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/quote-requests/current` | customer | Get / lazy-create the open draft |
| `POST /api/v1/quote-requests/current/items` | customer | Add line item |
| `PATCH /api/v1/quote-requests/current/items/:itemId` | customer | Update qty / requester note |
| `DELETE /api/v1/quote-requests/current/items/:itemId` | customer | Remove an item |
| `POST /api/v1/quote-requests/current/submit` | customer | Submit draft → `submitted` |
| `GET /api/v1/quote-requests` | customer | List own RFQs |
| `GET /api/v1/quote-requests/:id` | customer | Detail of any RFQ the buyer owns |
| `POST /api/v1/quote-requests/:id/accept` | customer | Accept a `quoted` RFQ → `accepted` (spawns an Order) |
| `POST /api/v1/quote-requests/:id/reject` | customer | Reject with reason `price` / `terms` / `other` and optional message |
| `GET /api/v1/admin/quote-requests` | admin | Roster with `filter[status]` / `filter[organizationId]` / `filter[assignedAdminUserId]` |
| `GET /api/v1/admin/quote-requests/:id` | admin | Detail (T092) |
| `POST /api/v1/admin/quote-requests/:id/claim` | admin | Assign to the current admin |
| `POST /api/v1/admin/quote-requests/:id/quote` | admin | Send a quote with per-item unit prices + optional discount + lead-time / validity terms |
| `POST /api/v1/admin/quote-requests/:id/decline` | admin | Decline with a free-text message surfaced to the buyer |

## State machine

`draft → submitted → in_review → quoted → (accepted | rejected | expired | cancelled)`.
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

- **Expiry policy** — `rfq-expiry-worker.ts` walks RFQs whose `expiresAt`
  has passed and transitions them; change the cadence or grace window
  there.
- **Quote → Order conversion** — accept emits the convert; new
  pre-conversion validation hooks belong in `rfq-service.ts#accept`.
- **Storefront entry point** — `components/rfq/AddToRfqForm.tsx` on the
  PDP is the canonical buyer-facing widget; themes can replace it
  without changing the API.
