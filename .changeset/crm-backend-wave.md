---
'@endora-commerce/mod-crm': minor
---

The CRM module's backend gains the reverse direction of status following.

- **An order's status moves its opportunity.** `PUT /api/v1/admin/crm/order-status-mappings`
  accepts `direction: "order_to_opportunity"` — refused with 422 until now — with an optional
  `requireAllOrders`. The module subscribes to `order.status_changed.v1`: when a linked order
  that follows its opportunity reaches a mapped status, the opportunity moves through its own
  workflow (graph, guards and events included), as the system, with `cause: "order_status"`
  and `causeOrderId` on the events and in the status history. A closed opportunity is never
  reopened; a move the workflow refuses is recorded as a `skipped` outcome and an audit entry
  `crm.opportunity.propagation_skip`; `requireAllOrders` holds the move until every following
  order is in a status mapped to the same opportunity status.
- **Mappings in both directions do not loop.** A change the module asked an order for is
  recognised as its own echo and moves nothing; a move caused by an order asks no order to
  follow.
- **`CRM_WORKFLOW_INVALID` has a new `details.rule`**, `mapping_duplicate_order_status`: one
  order status maps to one opportunity status.
- **`orderStatusKnown` on `GET /workflow` is no longer always `true`.** It is `false` once the
  Orders module has answered `unknown_status` for that order status, and `true` again when an
  order next accepts it. A mapping nobody has used yet reads `true`.
