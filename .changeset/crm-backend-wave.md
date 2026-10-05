---
'@endora-commerce/mod-crm': minor
'@endora-commerce/contracts': minor
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

It also gains assignment.

- **`POST /api/v1/admin/crm/opportunities/:id/assign`** (`crm:write`, `{ adminUserId: uuid | null }`)
  assigns, reassigns or unassigns and answers the opportunity. It emits
  `crm.opportunity.assigned.v1` with the previous assignee, as does a `PATCH` that changes the
  assignee.
- **A new opportunity gets a default assignee** when the request names none: among the active
  sales representatives assigned to its organization, the creator if they are one of them,
  otherwise the longest-standing. `assignedAdminUserId: null` still means "nobody".
- **The list accepts `assignedAdminUserId`** — `me`, `unassigned` or an administrator's id —
  which answered 422 until now.
- **`CRM_ASSIGNEE_INVALID`** (422) is raised for an assignee who is not an active
  administrator, on `/assign`, on create and on `PATCH`. **Behaviour change:** create and
  `PATCH` answered `VALIDATION_FAILED` for an unknown assignee and *accepted* a deactivated
  one.
- **The new assignee is notified** through `adminNotificationRecordPort` (kind
  `crm.opportunity.assigned`). The module declares a `degrades-without` edge on
  `admin_notifications`: with that module off, assignment works and nobody is notified.


And tags.

- **`GET|POST /api/v1/admin/crm/tags`, `PATCH|DELETE /tags/:id`** — the platform-wide tag list.
  Reading is `crm:read`; managing is `crm:configure`. A name is unique whatever its case: a
  clash answers 409 **`CRM_TAG_NAME_TAKEN`**, a new member of `ERROR_CODES`. `usageCount`
  counts only the opportunities the caller may see. Deleting a tag removes it from every
  opportunity that carried it.
- **`PUT /api/v1/admin/crm/opportunities/:id/tags`** (`crm:write`, `{ tagIds }`) replaces an
  opportunity's tags and answers the opportunity.
- **`tagIds` on create and on `PATCH`, and the `tagId` list filter, are accepted** — each
  answered 422 until now. Several `tagId` values mean all of them. `tags` on a summary and a
  detail is no longer always empty.

And notes and internal messages.

- **`GET|POST /api/v1/admin/crm/opportunities/:id/comments`, `PATCH|DELETE …/comments/:commentId`.**
  `kind` is `note` or `message`, and is required on the list. Reading is `crm:read`, writing
  `crm:write`.
- **A note is its author's**: anybody else editing or deleting it answers 403, whatever they
  hold. A deleted note is no longer listed; its text stays in the audit trail.
- **A message is immutable**: editing or deleting one answers 409 **`CRM_MESSAGE_IMMUTABLE`**,
  a new member of `ERROR_CODES`, whoever asks. A message notifies the assignee and every
  earlier author of a message on that opportunity, except its sender, through
  `adminNotificationRecordPort` (kind `crm.opportunity.message`); with `admin_notifications`
  off it is stored and nobody is told.
- Both are internal. The module still serves nothing outside `/api/v1/admin/crm`.

**`@endora-commerce/contracts`**: `ERROR_CODES` gains `CRM_ASSIGNEE_INVALID`,
`CRM_TAG_NAME_TAKEN` and `CRM_MESSAGE_IMMUTABLE`. Additive; a consumer that switches
exhaustively over `ErrorCode` gets a compile error until it handles them.
