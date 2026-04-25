---
title: currencies
---

# `currencies`

The installation-wide pool of accepted ISO 4217 currency codes (T238 /
FR-105). Mirrors the `languages` module.

## Public surface

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/i18n/config` | storefront / admin | Active currencies + default (shared with languages — see [languages](./languages)) |
| `GET /api/v1/admin/currencies` | admin | Full list |
| `PUT /api/v1/admin/currencies/:code` | admin | Upsert |
| `POST /api/v1/admin/currencies/:code/default` | admin | Promote to default (atomically demotes the prior default) |
| `DELETE /api/v1/admin/currencies/:code` | admin | Remove (rejected for the default) |

## Defaults

Same partial-unique-index pattern as `languages`. The migration bootstrap
seeds `PLN` (default) and `EUR`; symbol values are stored via Postgres
Unicode literals so the migration source stays ASCII.

## Entities

`Currency` — natural primary key on the ISO 4217 code; `label`,
`symbol`, `isDefault`, `isActive`, `sortOrder`.

## Extension points

- **Per-Sales-Channel default** — when a Sales Channel ships its own
  currency, gate `priceFor(cart)` in the orders module on the channel's
  configured currency rather than the global default.
- **Exchange-rate provider** — out of scope here; integrate via the
  `integrations` module when a real adapter is needed.
