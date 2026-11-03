---
'@endora-commerce/mod-orders': patch
---

Security fix (issue #665): cloning an order into a quote request and reordering it now resolve the
order through the same access rule as reading it. A member who is not an Organization administrator
can clone or reorder only the orders they placed. An Organization administrator can still act on
every order of the Organization. Any other order is answered `404 ORDER_NOT_FOUND`, the answer
`GET /api/v1/orders/:id` gives. This applies to `POST /api/v1/orders/:id/clone-to-quote` and
`POST /api/v1/orders/:id/reorder`. Before this change, the rule was enforced by those two routes
only, not by the services behind them.

The admin routes `POST /api/v1/admin/orders/:id/clone-to-quote` and
`POST /api/v1/admin/orders/:id/reorder` behave as before. A cloned quote request is no longer
created with the caller marked as an Organization administrator: the flag is now stated as
`false`, as every other caller that creates a quote request states it. No setting, permission,
migration or contract changes.
