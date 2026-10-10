---
title: quote_requests
description: RFQ lifecycle (draft → quote → accept/reject)
---

# `quote_requests`

The Quote Requests module implements the B2B negotiation loop.
A customer (or sales representative on the
customer's behalf) drafts a Quote Request, the other side reviews it,
either side may modify the request and require explicit re-acceptance,
and an approved Quote Request can be turned into an order through the
standard checkout. Every transition is captured in an append-only
event log so the customer-facing detail page and the admin detail page
both render the same chronological history.

## Statuses

Six values, replacing the foundation-era set:

- `Created from admin` — drafted by a sales rep / admin, awaiting customer acceptance.
- `Pending` — submitted by the customer, awaiting internal-side response.
- `Approved` — green-lit by the responsible party.
- `Completed` — an order has been placed from this Quote Request.
- `Canceled` — rejected by either party (with optional reason).
- `Expired` — auto-flipped by the expiry worker when the configured threshold elapses.

`Canceled`, `Completed`, and `Expired` are terminal.

## Public surface

Customer endpoints require a customer session; admin endpoints are
gated by `rfqs:handle`. PATCH-shaped endpoints accept `If-Match`
versions for optimistic concurrency, and customer accept/reject
revision additionally pin `expectedRevisionNumber`.

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/quote-requests` | customer | List visible Quote Requests (org-admin role expands to whole-org visibility). |
| `GET /api/v1/quote-requests/:id` | customer | Detail with optional `comparisonAgainstLastSeen` block while awaiting acceptance. |
| `POST /api/v1/quote-requests` | customer | Create + submit in one call. |
| `PATCH /api/v1/quote-requests/:id` | customer | Edit a Pending RFQ that the internal side has not yet touched. |
| `POST /api/v1/quote-requests/:id/accept-revision` | customer | Accept the seller's latest revision (also covers `Created from admin`). Needs an offer from the seller with every line priced — see *Agreed prices*. |
| `POST /api/v1/quote-requests/:id/reject-revision` | customer | Reject the latest revision with optional reason. |
| `POST /api/v1/quote-requests/:id/resubmit` | customer | Clone an old Quote Request into a new Pending one at the customer's current price list. |
| `POST /api/v1/quote-requests/:id/convert-to-order` | customer | Seed the customer's cart from an Approved RFQ at the agreed unit prices and return the checkout URL. |
| `GET /api/v1/admin/quote-requests` | admin | List, scoped by sales-rep assignment + filterable by status / organization. |
| `GET /api/v1/admin/quote-requests/:id` | admin | Detail with full actor identity in the event log. |
| `POST /api/v1/admin/quote-requests` | admin | Create on customer's behalf → status `Created from admin`. |
| `PATCH /api/v1/admin/quote-requests/:id` | admin | Modify a Pending or Created from admin RFQ → triggers customer re-acceptance. |
| `POST /api/v1/admin/quote-requests/:id/approve` | admin | Approve a Pending RFQ whose every line has an agreed unit price. |
| `POST /api/v1/admin/quote-requests/:id/cancel` | admin | Cancel with optional reason. |
| `POST /api/v1/admin/quote-requests/:id/assign` | admin | Set `assignedAdminUserId` (informational). |
| `GET /api/v1/admin/sales-reps/:adminUserId/organizations` | admin | Reverse view — organizations a rep is responsible for, with the count of open quote requests in each. |
| `GET /api/v1/storefront/settings/quote-requests` | public | Returns the two storefront visibility flags. |

The three endpoints that assign a sales representative *to* an organization —
`GET`, `POST` and `DELETE` under
`/api/v1/admin/organizations/:id/sales-reps` — belong to the **organizations**
module and are gated by `organizations:assign-sales-rep`, not by `rfqs:handle`.
They used to be registered here, and the split is not cosmetic: assigning a
representative qualifies an organization, so it must keep working when quote
requests is switched off, and it cannot be gated by a permission code declared
by a module that can disappear. The one endpoint left above is the one that
reads a quote request, and it is gated `rfqs:handle` precisely so that it
disappears with this module.

## Agreed prices

A Quote Request becomes an order only at unit prices the seller agreed. A
line's agreed unit price is set by an operator — when revising a request
(`PATCH /api/v1/admin/quote-requests/:id`) or when creating one on a
customer's behalf — and is empty until then. An empty agreed price is never
read as a number: nothing falls back to zero, to the customer's desired price
or to the list price.

Three operations depend on it, and each answers `409` when the rule is not
met:

| Operation | Refused when | Code |
| --- | --- | --- |
| `accept-revision` | The seller has made no offer to accept: the request is not `Created from admin` and is not awaiting the customer's acceptance of a seller revision. | `RFQ_NOT_QUOTED` |
| `accept-revision` | The seller's offer leaves a line without an agreed unit price. | `QUOTE_INCOMPLETE` |
| admin `approve` | Any line has no agreed unit price. | `QUOTE_INCOMPLETE` |
| `convert-to-order` | Any line has no agreed unit price. | `QUOTE_INCOMPLETE` |

What this means in practice:

- An operator who wants to approve a request as the customer raised it prices
  every line first, then approves. There is no "approve at the list price"
  shortcut.
- The rules are about a **missing** price. An agreed unit price of exactly
  `0` that an operator entered — a free sample line — is an agreed price like
  any other, and such a request can be accepted, approved and ordered.
- `reject-revision` is not affected: a customer can still withdraw a request
  the seller has not answered yet.
- A request that reached `Approved` with an unpriced line before these rules
  existed cannot be converted into an order. Its lines can no longer be
  edited, so the way forward is `resubmit`, which raises a new request for the
  seller to price.

## Visibility model

A sales representative is a platform administrator with the
`sales_representative` role. The
`SalesRepAssignmentService.canSeeOrganization(adminUserId, organizationId)`
predicate centralises the visibility rule:

1. `platform_admin` role → sees every organization.
2. Otherwise the admin sees an organization iff a row in
   `organization_sales_rep_assignments` ties them together, OR the
   organization has zero rows in that table (the "unassigned-org
   fallback" — visible to every sales rep).

A customer with the `org_admin` role on their own organization sees
every Quote Request in the organization, not just their own.

## Settings

Three settings drive the module — all live under the `quote_requests`
group and are configured through the existing settings module.

| Code | Type | Default | Effect |
| --- | --- | --- | --- |
| `quote_requests.expiry_days` | integer | `0` | Auto-expire Pending / Created from admin RFQs after N days. `0` disables. |
| `quote_requests.show_add_to_quote_on_card` | boolean | `true` | Toggle the "Add to quote" button on storefront product cards. |
| `quote_requests.show_add_to_quote_on_pdp` | boolean | `true` | Toggle the "Add to quote" button on product detail pages. |

## Background jobs

`RfqExpiryWorker.sweep()` runs every 30 minutes via the foundation
BullMQ scheduler. It reads `quote_requests.expiry_days` from the
settings module's resolved snapshot; if that value is 0 the sweep is
a no-op. Otherwise it transitions every Pending and Created from
admin row whose `updated_at < now() - INTERVAL <expiryDays> days` to
`Expired`, writes one `expired` event per row, and fans out
notifications to both parties.

## Data model

Three tables on top of the foundation `quote_requests` and
`quote_request_items`:

- `quote_request_revisions` — full snapshot per modify event.
- `quote_request_events` — append-only history (one row per state
  transition or modification, with discriminated-union payload).
- `quote_request_notification_events` — one row per recipient ×
  channel; unique on `(quote_request_id, source_event_id, recipient*,
  channel)` so retries are idempotent.

`organization_sales_rep_assignments` — the m:n relation between
organizations and admin users that the visibility model above reads —
is **not** one of them: it is owned by the `organizations` module,
which qualifies the organization with it, and this module reaches it
through that module's `organizationSalesRepScopePort`.

The canonical `quote_requests` row carries the current state plus
`current_revision_number`, `last_customer_seen_revision_number`, and
`awaiting_customer_revision_acceptance`. The customer's "what changed
since I last visited" diff is computed on read by comparing the
revision identified by `last_customer_seen_revision_number` against
the revision identified by `current_revision_number`.

### `sales_channel_id` is nullable, and stays nullable

Every request records the sales channel it was raised on, taken from
the resolved request channel. The column is nullable and will remain
so.

It was added nullable on purpose: the deploy that shipped it must not
depend on the boot-time default-channel reconciler having already run,
which is the ordinary phased shape — add nullable, start writing,
backfill, flip to `NOT NULL`. The middle step is the one that cannot
be taken here. Nothing wrote the column between the migration that
added it and the change that started populating it, so every request
raised in that window carries `null`, and no record anywhere says
which channel it came from. Projecting the system-default channel over
that gap would not recover an attribution, it would invent one — and
the sales-channel delete guard would then start refusing deletions on
evidence the platform made up.

A deployment that genuinely needs the column non-nullable therefore
deletes the null tail, or takes a per-row answer from a source that
knows one. There is no backfill script, and there deliberately never
will be one.

## Notifications

Every state transition fans out through `RfqNotificationService` to
the appropriate recipients (customer for admin-side actions, sales
reps + platform admins for customer-side actions, both parties on
expiry). Email and in-account channels both fire. The unique
constraint on `quote_request_notification_events` guarantees once-only
delivery per (transition, recipient, channel).

## Conversion to order

`POST /api/v1/quote-requests/:id/convert-to-order` fills the customer's
basket with the lines of an `Approved` quote request at the agreed unit
prices, and marks the basket with the quote request it was filled from. The
order placed from that basket records it (`source_quote_request_id`) — while
the quote request is still `Approved` and at least one line is still in the
basket at the agreed price; the Orders module's page says what drops the mark.

When an order is created with a populated `source_quote_request_id`,
an event subscriber inside the module flips the originating Quote
Request to `Completed`, populates `converted_order_id`, and fires the
`completed` notification. A completed quote request cannot be ordered a second
time, and the conversion is refused while any line has no agreed unit price
(see *Agreed prices*). The subscriber waits for the order to be committed — a little over two
seconds at most — and completes nothing for an order of another organization.

With this module switched off, a basket filled earlier is still checked out, at
the agreed prices, as an ordinary order: it records no quote request and the
quote request is not completed.

## Created by an administrator: the event and its origin

A quote request an administrator creates through
`POST /api/v1/admin/quote-requests` is announced on the in-process event bus as
`rfq.created_by_admin.v1`, once, after its rows are written:

| Field | Meaning |
| --- | --- |
| `rfqId` | The new quote request. |
| `organizationId` | The organization it was created for. |
| `adminUserId` | The administrator who created it. |
| `origin` | What the create request carried as `origin`, or `null`. |

`rfq.created.v1` remains the event of a customer's own submission and is
**not** emitted on this path, so nothing that listens to it starts seeing
requests an administrator prepared.

The create request may carry an optional `origin: { type, id }` saying where
the quote request is being created from — `type` a lower-case identifier of the
sender's own (letters, digits, underscores), `id` a UUID. The module validates
the shape and hands the value on, unread, with the event: it is not stored, not
returned and changes nothing about the quote request. A module that recognises
the `type` may act on it — the CRM module links such a quote request to the
opportunity it was created from. The customer's own endpoint accepts no such
field.

The create screen (`/quote-requests/new`) reads the same from its query string
when another screen opens it: `originType` and `originId`, `organizationId` and
`customerAccountId` to preselect the customer, and `returnTo`, a path inside
the Admin UI to go back to once the quote request exists.

## Events offered to outbound webhooks

The module contributes two event types to the `webhooks` module's
`webhookEventRegistry`, so a webhook subscription can name them while both
modules are switched on. The payload is sent whole; the strict schemas are
`QUOTE_REQUEST_WEBHOOK_EVENT_SCHEMAS` in `@endora-commerce/contracts`.

| Event | Sent when | Payload, beside `eventId` and `occurredAt` |
| --- | --- | --- |
| `rfq.created.v1` | A customer submits a quote request. A quote request an administrator creates is `rfq.created_by_admin.v1`, which is not offered to webhooks. | `rfqId` (UUID), `organizationId` (UUID) |
| `rfq.expired.v1` | The expiry sweep (`RfqExpiryWorker.sweep()`) moves a quote request to `Expired`. One event per quote request. Nothing else sends it, so it occurs only where that sweep runs. | `rfqId`, `organizationId` |

- **No content leaves.** The payloads carry the two identifiers and nothing of
  the request: no line, quantity, price, note, customer or administrator. A
  receiver reads the quote request through the API with its own permissions.
- **One Organization's data.** A platform-wide subscription receives every
  Organization's events. A subscription bound to an Organization receives only
  the events whose `organizationId` is that Organization — never another's.
- **After the write.** `rfq.created.v1` is sent once the request, its lines and
  its history are saved; a submission that is refused sends nothing.
  `rfq.expired.v1` is sent after the status change is saved.
- **While the module is switched off** neither type is offered and a new
  subscription to them is refused; stored subscriptions are kept and receive
  nothing until it is back on.

No other quote-request event is delivered to webhooks: approval, modification,
cancellation and conversion are announced on the in-process event bus only.

## Panels on the quote request screen

The admin zone `quote_request.detail.after` is mounted once at the end of a
quote request's screen, below the card that holds its tabs, and hands a
contribution `{ quoteRequestId }`. A module adds a panel by declaring
`zoneComponent('quote_request.detail.after', …)` in its own admin
contributions; this module names no contributor and imports none. With nothing
contributed — no such module, the module switched off, or a person without the
panel's permission — the zone renders nothing and the screen is exactly the one
without it. The CRM module contributes the opportunity a quote request is
linked to.
