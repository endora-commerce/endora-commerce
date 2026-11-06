---
'@endora-commerce/mod-admin-users': minor
---

Impersonation refuses a target it cannot use with the customer record's own codes instead of the generic `404 NOT_FOUND` (issue #814). `POST /api/v1/admin/organizations/:id/impersonate` and `POST /api/v1/admin/customers/:id/impersonate` answer `404 CUSTOMER_NOT_FOUND` for a customer that does not exist or is outside the organization or the operator's scope, and `409 CUSTOMER_ALREADY_DELETED` for a soft-deleted customer in scope. A soft-deleted customer outside the scope still answers `404 CUSTOMER_NOT_FOUND`. In every one of these cases impersonation is still refused: no audit entry is written and no session is minted. The permission check still runs first, so a caller without `customers:impersonate` gets the same `403` for any target.
