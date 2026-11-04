---
'@endora-commerce/mod-quick-order': minor
---

One-click purchase and quick order by organization permission (`specs/170-organization-roles/`, WP-06; part of issue #653).

- Declares the organization permission `quick_order.one_click` (*One-click purchase*, member-default).
- `GET /api/v1/quick-order/one-click/eligibility` answers `permission_required` when the member's role lacks `quick_order.one_click`, and `cart_approval_required` when it holds it but lacks `carts.order_without_approval`, before the setting and the defaults. `POST /api/v1/quick-order/one-click` is refused `403 ORGANIZATION_PERMISSION_REQUIRED` naming the first missing of the two, before any basket is written — one-click no longer bypasses cart approval.
- `POST /api/v1/quick-order/import` needs `carts.create`; `POST /api/v1/quick-order/build` needs `carts.create` for target `cart` and `quote_requests.create` for target `quote_request`. The admin on-behalf build stays gated by `orders:write` only.
- Organization-scope defaults, and other members' defaults, are managed by a member holding the *Administrator* role (`403 FORBIDDEN` otherwise), no longer by the legacy account role.
