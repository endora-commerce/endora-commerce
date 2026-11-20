---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-crm': minor
'@endora-commerce/mod-tasks': minor
'@endora-commerce/mod-i18n': minor
---

**A status or priority list is reordered in one request** (issue #1560). Three new endpoints take the
whole list in its new order and change it in one audited Command, so a move is one history entry and
one undo step, and a list is never left half-moved:

| Route | Permission | Command | Answers |
| --- | --- | --- | --- |
| `PUT /api/v1/admin/crm/statuses/order` | `crm:configure` | `crm.status.reorder` | the workflow, as `GET /crm/workflow` |
| `PUT /api/v1/admin/tasks/statuses/order` | `tasks:configure` | `tasks.status.reorder` | the workflow, as `GET /tasks/workflow` |
| `PUT /api/v1/admin/tasks/priorities/order` | `tasks:configure` | `tasks.priority.reorder` | the list, as `GET /tasks/priorities` |

The body is `{ orderedCodes: string[] }` and must be exactly the configured codes, each once.
Anything else — a code that is not configured, a row left out, a row named twice — answers
`409 ORDER_STALE`, a new code in
`ERROR_CODES` with an English and Polish sentence in `@endora-commerce/mod-i18n` — the list changed
since the caller loaded it, so reload it. The weights are rewritten 10, 20, 30, … in the new order.
The audit entry records `{ order: [codes] }` before and after.

New in `@endora-commerce/contracts`: `ReorderOpportunityStatusesRequestSchema`,
`ReorderTaskStatusesBodySchema`, `ReorderTaskPrioritiesBodySchema` (and their types) and
`ERROR_CODES.ORDER_STALE`.

In the admin, the CRM status settings and the Tasks status and priority settings move a row with
up/down buttons on the row instead of a position number in the status or priority dialog; the
position field is gone from the dialogs, and a new status or priority goes last. A move shows at
once, is undone with a message if the server refuses it, and reloads the list with a message if
somebody else changed it meanwhile. The `PATCH` endpoints still accept `weight`. No setting,
permission or migration changes.
