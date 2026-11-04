---
'@endora-commerce/mod-orders': patch
---

Placing an order from one's own basket passes the placer's organization role, off the request's actor, to `carts`' approval rule, so placement no longer reads the placer's account for it (`specs/170-organization-roles/` FR-080). `CustomerContext` and the `resolveCustomerContext` option gain an optional `organizationRoleId`; a composition that does not pass it is served as before.
