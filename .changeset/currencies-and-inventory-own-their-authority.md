---
'@endora-commerce/mod-currencies': major
'@endora-commerce/mod-inventory': major
'@endora-commerce/mod-languages': major
'@endora-commerce/mod-i18n': patch
---

`currencies` and `inventory` declare their own permission codes, and their admin routes enforce
them instead of the catalogue's and the order module's. `currencies` also takes back the four
routes `languages` was registering on its behalf.

**Breaking for anyone whose roles reach either module's admin API, and for anyone importing
`I18nRoutesDeps` from `@endora-commerce/mod-languages/backend`.**

## `currencies` — four routes and a new owner

The routes moved module *and* code. They were registered by `languages` and gated on
`catalog:write` — all four, the list read included, so seeing the currency table required the
authority to delete a row from it:

```
GET    /api/v1/admin/currencies            languages, catalog:write -> currencies, currencies:read
PUT    /api/v1/admin/currencies/:code      languages, catalog:write -> currencies, currencies:write
POST   /api/v1/admin/currencies/:code/default  languages, catalog:write -> currencies, currencies:write
DELETE /api/v1/admin/currencies/:code      languages, catalog:write -> currencies, currencies:write
```

`registerI18nRoutes`' `I18nRoutesDeps` no longer takes `currencyAdmin`; `currencyRead` stays, for
`GET /api/v1/i18n/config`, which composes both catalogues into one public payload and is
unchanged. The new entry point is `registerCurrencyRoutes` in
`@endora-commerce/mod-currencies/backend` — but a host does not call it: the module registers its
own routes through `ctx.routes`, which is what makes the module-presence gate structural instead
of a note in a comment.

`@endora-commerce/mod-currencies` gains `auth` in its manifest `dependencies` (it resolves
`requireAdmin` now) and `fastify` in its peer dependencies.

## `inventory` — 21 gates

Nine reads on `orders:read` and twelve writes on `catalog:write`, all of them over this module's
own tables: warehouses, stock levels, display-band thresholds, the back-in-stock queue, the CSV
importer, and the channel↔warehouse assignment that decides which stock a channel may sell.
Every one is now `inventory:read` or `inventory:write`.

The channel↔warehouse routes are the ones to look at if you embed
`admin/src/modules/warehouses/ChannelMembershipPanel`: a role that may edit a sales channel and
holds no inventory code now sees no panel, where before it saw one backed by `catalog:write`.

`open-inventory`, the module's ⌘K action, moves from `orders:read` to `inventory:read` with its
route.

## No data migration, in both cases

Granting the new codes to every holder of `catalog:write` or `orders:read` would reproduce the
distribution the split exists to remove, which would make this a change of spelling rather than
of authority. A role that reached these screens through the borrowed codes is granted the new
ones explicitly on `/admin-roles`, where the manifests put them automatically.

`@endora-commerce/mod-i18n` carries the four `adminRoles.permission.*` labels and the inventory
screens' refusal notice, in `en` and `pl`.
