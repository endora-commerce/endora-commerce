---
'@endora-commerce/mod-dhl-parcel': minor
---

New package: the DHL Parcel (DHL24 Poland) shipping module, leaving `backend/src/modules/`
in the same packaging shape as `@endora-commerce/mod-blog` and `@endora-commerce/mod-quote-requests`.

Three subpaths, no root wildcard, every one of them compiled output (D-164):

- `@endora-commerce/mod-dhl-parcel` — the manifest (settings, activation, permissions, palette action).
- `@endora-commerce/mod-dhl-parcel/backend` — `registerModule(ctx)` and the `entities` array.
  **No entity class is exported by name** (D-168).
- `@endora-commerce/mod-dhl-parcel/migrations` — the `migrations` array plus the two migration
  classes by name for the host registry.

`fast-xml-parser` is a direct dependency (SOAP envelopes). Peers cover platform, contracts,
MikroORM, Fastify, BullMQ, ioredis and zod. The manifest id stays `dhl_parcel` (D-142).
