---
'@endora-commerce/mod-delivery-methods': major
'@endora-commerce/mod-payment-methods': major
'@endora-commerce/mod-i18n': patch
---

`delivery_methods` declares `delivery_methods:read` and `delivery_methods:write`, and its admin
routes enforce them instead of `catalog:read` / `catalog:write`.

**Breaking for anyone whose roles reach either module's admin API.** The three
`delivery_methods` routes moved:

```
GET    /api/v1/admin/delivery-methods         catalog:read   -> delivery_methods:read
PUT    /api/v1/admin/delivery-methods/:code   catalog:write  -> delivery_methods:write
DELETE /api/v1/admin/delivery-methods/:id     catalog:write  -> delivery_methods:write
```

And the shared route `@endora-commerce/mod-payment-methods` registers moved with them:

```
GET    /api/v1/admin/order-statuses
  payment_methods:read OR catalog:read  ->  payment_methods:read OR delivery_methods:read
```

That route is read by two admin editors — the payment-method screen and the delivery-method one
— which is why it is an any-of. The `catalog:read` member was a placeholder for the delivery
editor's gate while `delivery_methods` still borrowed the catalogue's authority; it is now that
module's own read code, so no catalogue holder reaches the shared list any more.

There is no data migration and that is deliberate: granting the new codes to every holder of
`catalog:read` would reproduce the distribution the change exists to remove, which would make it a
change of spelling rather than of authority. A role that was configuring delivery methods through
the catalogue codes is granted `delivery_methods:read` / `delivery_methods:write` on
`/admin-roles`, where the manifest puts them automatically.

`@endora-commerce/mod-i18n` carries the two `adminRoles.permission.delivery_methods:*` labels and
the screen's refusal notice, in `en` and `pl`.
