---
'@endora-commerce/mod-quick-order': minor
---

The buyer's quick-order import admits either target's permission (`specs/170-organization-roles/`, owner ruling OR-10, FR-030b). `POST /api/v1/quick-order/import` used to require `carts.create`; it now serves a member holding `carts.create` **or** `quote_requests.create`, judged after `requireCustomer` and before the file is parsed. A member holding neither is still refused `403 ORGANIZATION_PERMISSION_REQUIRED` with `details.permission = 'carts.create'`, malformed file included, and a code whose module is switched off grants nothing. `POST /api/v1/quick-order/build` is unchanged: a cart still needs `carts.create`, a quote request `quote_requests.create`. No member loses access on upgrade, because *Member* holds both codes.
