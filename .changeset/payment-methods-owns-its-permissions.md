---
'@endora-commerce/mod-payment-methods': major
---

`payment_methods` declares `payment_methods:read` and `payment_methods:write`, and its admin routes
enforce them instead of `catalog:read` / `catalog:write`.

**Breaking for anyone whose roles reach this module's admin API.** The six admin routes moved:

```
GET    /api/v1/admin/payment-methods              catalog:read   -> payment_methods:read
GET    /api/v1/admin/payment-methods/adapters     catalog:read   -> payment_methods:read
PUT    /api/v1/admin/payment-methods/:code        catalog:write  -> payment_methods:write
PATCH  /api/v1/admin/payment-methods/:id/status   catalog:write  -> payment_methods:write
DELETE /api/v1/admin/payment-methods/:id          catalog:write  -> payment_methods:write
GET    /api/v1/admin/order-statuses               catalog:read   -> payment_methods:read OR catalog:read
```

There is no data migration and that is deliberate: granting the new codes to every holder of
`catalog:read` would reproduce the distribution the change exists to remove, which would make it a
change of spelling rather than of authority. A role that was configuring payment methods through
the catalogue codes is granted `payment_methods:read` / `payment_methods:write` on `/admin-roles`,
where the manifest puts them automatically.

`GET /api/v1/admin/order-statuses` is an any-of and not a widening: the route is registered by this
package and read by two admin editors, and `delivery_methods` still gates its own screen on
`catalog:read`. That member is removed by the merge request that gives `delivery_methods` its own
pair.

The manifest's `open-payment-methods` palette action declares `payment_methods:read`, so the
palette goes on advertising exactly what the target route opens.
