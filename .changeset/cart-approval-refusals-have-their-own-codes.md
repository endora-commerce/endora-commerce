---
'@endora-commerce/mod-carts': minor
'@endora-commerce/contracts': patch
---

Six refusals of `carts` have an error code of their own instead of `VALIDATION_FAILED`, and a
sentence in English and Polish (issue #86). **A client that matches on `VALIDATION_FAILED`, or on
the token that was the message, for these cases now sees the specific code**; the HTTP status of
each is unchanged (`422`). Until now the message was a machine token, which the error envelope
never replaces for `VALIDATION_FAILED`, so the buyer and the operator read the token in every
language.

| Route | Was (`422 VALIDATION_FAILED`, message) | Is (`422`) | `details` |
| --- | --- | --- | --- |
| `POST /api/v1/cart/submit-for-approval` | `approval_not_required` | `CART_APPROVAL_NOT_REQUIRED` | — |
| `POST /api/v1/cart/submit-for-approval` | `approval_already_initiated` | `CART_APPROVAL_ALREADY_SUBMITTED` | `cartId`, `approvalStatus` |
| `POST /api/v1/cart/submit-for-approval` | `org_admin_self_submit` | `CART_APPROVAL_SELF_SUBMIT` | — |
| `POST /api/v1/organization/carts/:id/approve` and `/reject` | `approval_not_pending` | `CART_APPROVAL_NOT_PENDING` | `cartId`, `approvalStatus` |
| `POST /api/v1/admin/carts/:id/reject` | `already_terminal` | `CART_ALREADY_TERMINAL` | `cartId`, `status` |
| `POST /api/v1/cart/from-quote-request/:quoteRequestId` | `quote_request_empty` | `RFQ_EMPTY` | `quoteRequestId` |

`RFQ_EMPTY` is the existing code of `quote_requests`, answered with its sentence; the other five are
new members of `ERROR_CODES` in `@endora-commerce/contracts`, declared by the `carts` manifest. No
setting, permission or migration changes.
