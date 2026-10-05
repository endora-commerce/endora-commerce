---
'@endora-commerce/mod-crm': minor
'@endora-commerce/contracts': minor
---

More of the new CRM module's backend, in the same first release as `crm-module.md` describes:
the reverse direction of status following, assignment, tags, notes and internal messages, and
attachments. Nothing here changes behaviour a released version had.

**The reverse direction of status following.**

- **An order's status moves its opportunity.** `PUT /api/v1/admin/crm/order-status-mappings`
  accepts `direction: "order_to_opportunity"` beside the forward direction, with an optional
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
- **`orderStatusKnown` on `GET /workflow` is evidence, not validation.** It is `false` once the
  Orders module has answered `unknown_status` for that order status, and `true` again when an
  order next accepts it. A mapping nobody has used yet reads `true`.

**Assignment.**

- **`POST /api/v1/admin/crm/opportunities/:id/assign`** (`crm:write`, `{ adminUserId: uuid | null }`)
  assigns, reassigns or unassigns and answers the opportunity. It emits
  `crm.opportunity.assigned.v1` with the previous assignee, as does a `PATCH` that changes the
  assignee.
- **A new opportunity gets a default assignee** when the request names none: among the active
  sales representatives assigned to its organization, the creator if they are one of them,
  otherwise the longest-standing. `assignedAdminUserId: null` still means "nobody".
- **The list and the board accept `assignedAdminUserId`** — `me`, `unassigned` or an
  administrator's id.
- **`CRM_ASSIGNEE_INVALID`** (422) is raised for an assignee who is not an active
  administrator — unknown, deactivated or deleted — on `/assign`, on create and on `PATCH`.
- **The new assignee is notified** through `adminNotificationRecordPort` (kind
  `crm.opportunity.assigned`). The module declares a `degrades-without` edge on
  `admin_notifications`: with that module off, assignment works and nobody is notified.

**Tags.**

- **`GET|POST /api/v1/admin/crm/tags`, `PATCH|DELETE /tags/:id`** — the platform-wide tag list.
  Reading is `crm:read`; managing is `crm:configure`. A name is unique whatever its case: a
  clash answers 409 **`CRM_TAG_NAME_TAKEN`**, a new member of `ERROR_CODES`. `usageCount`
  counts only the opportunities the caller may see. Deleting a tag removes it from every
  opportunity that carried it.
- **`PUT /api/v1/admin/crm/opportunities/:id/tags`** (`crm:write`, `{ tagIds }`) replaces an
  opportunity's tags and answers the opportunity.
- **`tagIds` on create and on `PATCH`, and the `tagId` filter of the list and the board.**
  Several `tagId` values mean all of them. A summary and a detail carry `tags`, by name.

**Notes and internal messages.**

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

**Attachments.**

- **`GET|POST /api/v1/admin/crm/opportunities/:id/attachments`, `DELETE …/attachments/:attachmentId`.**
  An attachment is a link to a file of the media library, by asset id. Reading is `crm:read`,
  writing `crm:write`.
- **Only a `private` asset can be attached** — a public one, and one that is not in the
  library, answers 422. The library uploads as `public` by default, so the caller uploads with
  `visibility: 'private'`.
- **`url` is resolved by the module** through `assetsLibraryPort.getAsset`: a signed,
  short-lived link, served under `crm:read` with no permission of the media library, and only
  under an opportunity the caller may see. An asset already attached to an opportunity out of
  the caller's reach is refused as nonexistent.
- **The library refuses to delete an attached file.** The module contributes an
  asset-reference descriptor (kind `crm_opportunity_attachment`) from a contribution-only boot
  hook, so the protection holds while the module is switched off.
- Attaching an asset the opportunity already has answers 200 with the existing attachment.

**`@endora-commerce/contracts`**: `assetReferenceKindSchema` gains
`'crm_opportunity_attachment'` — additive; a consumer that switches exhaustively over
`AssetReferenceKind` gets a compile error until it handles it. `ERROR_CODES` gains `CRM_ASSIGNEE_INVALID`,
`CRM_TAG_NAME_TAKEN` and `CRM_MESSAGE_IMMUTABLE`. Additive; a consumer that switches
exhaustively over `ErrorCode` gets a compile error until it handles them.
