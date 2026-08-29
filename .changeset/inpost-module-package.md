---
'@endora-commerce/mod-inpost': minor
---

New package: the InPost ShipX PL shipping module (feature 068), leaving
`backend/src/modules/` in the same shape as `@endora-commerce/mod-dhl-parcel`.

Three subpaths, no root wildcard, every one of them compiled output (D-164):

- `@endora-commerce/mod-inpost` — the manifest (settings, activation, `inpost:manage`,
  palette action).
- `@endora-commerce/mod-inpost/backend` — `registerModule(ctx)` and the `entities` array
  (`InpostShipmentLink`, `InpostWebhookEvent`). **No entity class is exported by name**
  (D-168).
- `@endora-commerce/mod-inpost/migrations` — the `migrations` array plus both migration
  classes by name for the host registry.

Peers cover platform, contracts, MikroORM, Fastify and zod; there is no worker and
therefore no `bullmq` or `ioredis`. Confirmation is webhook-only. The manifest id stays
`inpost` (D-142).
