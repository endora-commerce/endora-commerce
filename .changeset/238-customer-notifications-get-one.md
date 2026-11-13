---
'@endora-commerce/mod-customer-notifications': minor
---

`customer_notifications`: new storefront route `GET /api/v1/storefront/notifications/:id` (issue #238, `specs/179-rfq-and-customer-notifications/`). It answers one entry as `{ data: CustomerNotification }`, rendered in the request's language like the list, under the same visibility as the list — the caller's own entry, of the request's sales channel or of no channel, from a producing module that is present — and `404 NOT_FOUND` for any other id. It is read-only: it marks nothing, and it answers normally under impersonation. `Cache-Control: private, no-store`; `503 MODULE_DISABLED` while the module is off.
