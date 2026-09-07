---
title: quote_requests
description: RFQ lifecycle (draft → quote → accept/reject)
---

# `quote_requests`

The Quote Requests module — feature 008 — implements the B2B
negotiation loop. A customer (or sales representative on the
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
| `POST /api/v1/quote-requests/:id/accept-revision` | customer | Accept the latest revision (also covers `Created from admin`). |
| `POST /api/v1/quote-requests/:id/reject-revision` | customer | Reject the latest revision with optional reason. |
| `POST /api/v1/quote-requests/:id/resubmit` | customer | Clone an old Quote Request into a new Pending one at the customer's current price list. |
| `GET /api/v1/admin/quote-requests` | admin | List, scoped by sales-rep assignment + filterable by status / organization. |
| `GET /api/v1/admin/quote-requests/:id` | admin | Detail with full actor identity in the event log. |
| `POST /api/v1/admin/quote-requests` | admin | Create on customer's behalf → status `Created from admin`. |
| `PATCH /api/v1/admin/quote-requests/:id` | admin | Modify a Pending or Created from admin RFQ → triggers customer re-acceptance. |
| `POST /api/v1/admin/quote-requests/:id/approve` | admin | Approve a Pending RFQ. |
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

When an order is created with a populated `source_quote_request_id`,
an event subscriber inside the module flips the originating Quote
Request to `Completed`, populates `converted_order_id`, and fires the
`completed` notification. The cart-creation step that locks RFQ
agreed prices into a checkout cart is delivered through the existing
cart and checkout flows.
