---
'@endora-commerce/mod-invoices': patch
---

The buyer invoice routes for an order — `GET /api/v1/orders/:id/invoices` and
`GET /api/v1/orders/:id/invoices/:invoiceId/pdf` — now follow the order's own read scope. A regular
member of an Organization reaches only the invoices of orders they placed; an `organization_admin`
reaches the invoices of every order of the Organization. Any other order answers 404, as
`GET /api/v1/orders/:id` already did. Previously these routes accepted any order of the caller's
Organization.

`GET /api/v1/account/organization/invoices` is unchanged.
