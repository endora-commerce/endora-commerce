---
'@endora-commerce/mod-crm': minor
'@endora-commerce/contracts': minor
'@endora-commerce/mod-audit-logs': patch
'@endora-commerce/mod-orders': minor
'@endora-commerce/mod-quote-requests': minor
---

The second wave of CRM's Admin UI, and what it needed from its neighbours.

- **The audit log labels CRM's actions.** On the platform-wide audit log screen an entry
  written by the CRM module (`crm.opportunity.transition`, `crm.tag.create`, …) now reads as
  the sentence the Opportunity's own change history shows, instead of its action code.
- **Quote requests and the value on the Opportunity screen.** *Linked quote requests* lists,
  links and unlinks them — searched through a new CRM lookup,
  `GET /api/v1/admin/crm/lookups/quote-requests` (`crm:write`), so linking needs no code of
  the quote desk. *Value* shows whether the figure is entered by hand or computed, switches
  between the two, and names every document left out with the reason. *CRM → Workflow* gains
  the statuses that count towards a computed value; saving says that the figures follow in the
  background. With the Quote Requests module off the quote affordances are withdrawn and the
  reason is said.
- **Change history.** A new tab on the Opportunity reads its history a page at a time: each
  entry as a sentence, a status change in the statuses' names with the order that caused it,
  an edit field by field.
- **References.** The description, note and message fields insert `[[product:…]]` and
  `[[order:…]]` tokens from a search, and the saved text shows each as a link — or as
  unavailable. `@endora-commerce/contracts` gains `splitOpportunityReferenceText`, the
  quote-request lookup schemas and the exported `QUOTE_REQUEST_STATUS_VALUES`.
- **Create an order or a quote request from within an opportunity.** The Opportunity's
  *Linked orders* and *Linked quote requests* sections gain **Create order** (`crm:write` +
  `orders:write`) and **Create quote request** (`crm:write` + `rfqs:handle`, hidden while the
  Quote Requests module is off). Each opens the owner's create screen narrowed to the
  opportunity's organization; the created document is linked to the opportunity as
  `created_from_opportunity`, and gets no second opportunity when automatic creation is on.
  A quote request an administrator creates **without** an origin is now a candidate for
  `crm.auto_create_from_quote_requests`, as a customer's submission is.
- **`@endora-commerce/contracts`** gains `OriginReferenceSchema` / `OriginReference`
  (`{ type, id }`: a lower-case identifier of at most 64 characters and a UUID, strict), the
  optional `origin` on `adminCreateOrderRequestSchema` and `adminCreateQuoteRequestSchema`, and
  the event payload types `OrderCreatedEventPayload` and `RfqCreatedByAdminEventPayload` with
  the name `RFQ_CREATED_BY_ADMIN_EVENT`. All additive: a request without `origin` validates
  as before.
- **`@endora-commerce/mod-orders`** — additive. `POST /api/v1/admin/orders` accepts the
  optional `origin` and echoes it on `order.created.v1`; the key is absent from the event when
  the request carried none, so an existing subscriber sees the payload it always saw — an
  outbound webhook for `order.created.v1` included, whose payload is the event's and so
  carries `origin` for such an order. The value is not stored, not returned and not
  interpreted, and the storefront placement cannot set it. `OrderService.placeOrder` takes an optional third argument `{ origin? }`;
  `OrderPlacementPort` is unchanged. The create-order screen (`/orders/new`) reads
  `originType`, `originId`, `organizationId`, `customerAccountId`, `salesChannelId` and
  `returnTo` from its query string; opened without them it behaves as before.
- **`@endora-commerce/mod-quote-requests`** — additive. A new in-process event,
  `rfq.created_by_admin.v1` (`rfqId`, `organizationId`, `adminUserId`, `origin | null`), is
  emitted once per quote request created through `POST /api/v1/admin/quote-requests`, which
  accepts the same optional `origin`. `rfq.created.v1` is still emitted for a customer's
  submission only. The create screen (`/quote-requests/new`) reads `originType`, `originId`,
  `organizationId`, `customerAccountId` and `returnTo`; opened without them it behaves as
  before.
