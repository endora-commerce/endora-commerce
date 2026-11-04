---
'@endora-commerce/platform': minor
---

`OrganizationReadPort` (`@endora-commerce/platform/kernel`) loses `loadCartApprovalPolicy(organizationId)`, which nothing called; the per-organization cart-approval policy it read is replaced by the `carts.order_without_approval` organization permission (`specs/170-organization-roles/`, OR-3, WP-03). The port is `{ loadEffectiveOrganization, assertCanTransact }`.
