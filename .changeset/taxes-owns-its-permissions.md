---
'@endora-commerce/mod-taxes': major
'@endora-commerce/mod-i18n': patch
---

`taxes` declares `taxes:read` and `taxes:write`, and its admin routes enforce them instead of
`catalog:write`.

**Breaking for anyone whose roles reach this module's admin API.** All four routes moved, and
unlike the three modules that preceded it, every one of them was gated on the catalogue's
**write** code — there was no read gate to move:

```
GET    /api/v1/admin/taxes           catalog:write -> taxes:read
GET    /api/v1/admin/taxes/preview   catalog:write -> taxes:read
PUT    /api/v1/admin/taxes/:code     catalog:write -> taxes:write
DELETE /api/v1/admin/taxes/:id       catalog:write -> taxes:write
```

So `taxes:read` is a capability that did not exist before rather than a rename of one: an
operator can now be shown a VAT rate without being handed the authority to change it. Grant it
alone for a finance or support role; grant the pair to configure rates.

Nothing that *computes* tax is affected. `orders`, `carts`, `product_feeds` and `quote_requests`
resolve a rate through the `taxService` port in process; these routes serve the admin
configuration screen and nothing else.

There is no data migration and that is deliberate: granting the new codes to every holder of
`catalog:write` would reproduce the distribution the change exists to remove, which would make it
a change of spelling rather than of authority. A role that was configuring tax rules through the
catalogue code is granted `taxes:read` / `taxes:write` on `/admin-roles`, where the manifest puts
them automatically.

`@endora-commerce/mod-i18n` carries the two `adminRoles.permission.taxes:*` labels and the
screen's refusal notice, in `en` and `pl`.
