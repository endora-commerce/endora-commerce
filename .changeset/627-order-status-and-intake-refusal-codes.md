---
'@endora-commerce/mod-orders': minor
'@endora-commerce/contracts': patch
---

The admin's order-status configuration and the external API order intake answer their refusals
with error codes of their own instead of `VALIDATION_FAILED`, and a sentence in English and Polish
(issue #627, part of #86; the slice #621 left). **A caller that matches on `VALIDATION_FAILED`, or
an API integration retrying on `details.code` `intake_busy`, now sees the specific code.** The HTTP
status is unchanged. Until now an operator working in Polish read English, because the error
envelope never replaces the message of `VALIDATION_FAILED`.

| Route | Was | Is | `details` |
| --- | --- | --- | --- |
| `POST /api/v1/admin/orders/statuses` | `409 VALIDATION_FAILED`, *Status "X" already exists.* | `409 ORDER_STATUS_CODE_TAKEN` | `statusCode` |
| `PATCH /api/v1/admin/orders/statuses/:code` | `409 VALIDATION_FAILED`, *Cannot mark "X" terminal while it has outgoing transitions.* | `409 ORDER_STATUS_TERMINAL_HAS_TRANSITIONS` | `code: 'mark_terminal'`, `statusCode`, `outgoingCount` |
| `PUT /api/v1/admin/orders/transitions` | `422 VALIDATION_FAILED`, *Terminal status "X" cannot have outgoing transitions.* | `422 ORDER_STATUS_TERMINAL_HAS_TRANSITIONS` | `code: 'add_transition'`, `statusCode`, `toStatusCode` |
| `DELETE /api/v1/admin/orders/statuses/:code` | `409 VALIDATION_FAILED`, *The initial status cannot be deleted.* | `409 ORDER_STATUS_NOT_DELETABLE` | `code: 'initial'`, `statusCode` |
| `DELETE /api/v1/admin/orders/statuses/:code` | `409 VALIDATION_FAILED`, *System status "X" cannot be deleted.* | `409 ORDER_STATUS_NOT_DELETABLE` | `code: 'system'`, `statusCode` |
| `DELETE /api/v1/admin/orders/statuses/:code` | `409 VALIDATION_FAILED`, *Cannot delete status "X" while N order(s) use it.* | `409 ORDER_STATUS_IN_USE` | `statusCode`, `orderCount` |
| `POST /api/v1/external/orders` | `422 VALIDATION_FAILED`, *One or more order lines were refused.* | `422 ORDER_INTAKE_LINES_REFUSED` | unchanged: the per-line array of `{ path, issue, sku }` |
| `POST /api/v1/external/orders` | `409 VALIDATION_FAILED`, `details.code` `intake_busy` | `409 ORDER_INTAKE_BUSY` | none |

The status code travels as `details.statusCode`, because `details.code` is the slot for a
refusal's token. The intake's per-line array keeps its shape, so an integration reading each
line's `issue` needs no change beyond the code; its sentence names no count, since only scalar
`details` fill a sentence. A transition naming a status that does not exist stays
`VALIDATION_FAILED`. The six codes are members of `ERROR_CODES` in `@endora-commerce/contracts`,
declared by the `orders` manifest; the module's documentation page and the API access page list
them. No setting, permission or migration changes.
