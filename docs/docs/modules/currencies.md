---
title: currencies
---

# `currencies`

The installation-wide pool of accepted ISO 4217 currency codes (T238 /
FR-105). Mirrors the `languages` module.

## Public surface

| Verb + Path | Permission | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/currencies` | `currencies:read` | Full list |
| `PUT /api/v1/admin/currencies/:code` | `currencies:write` | Upsert |
| `POST /api/v1/admin/currencies/:code/default` | `currencies:write` | Promote to default (atomically demotes the prior default) |
| `DELETE /api/v1/admin/currencies/:code` | `currencies:write` | Remove (rejected for the default) |

`GET /api/v1/i18n/config` also answers with the active currencies and the
default, and is **`languages`'** route rather than this module's: it composes
both catalogues into one public payload and reads this module's half over
`currencyReadPort`. See [languages](./languages).

## Permissions

`currencies:read` and `currencies:write`, this module's own since 2026-08-29.

The four routes above lived in `languages` until then and enforced
`catalog:write` — all four, the list read included — so whoever could edit a
product description could add a currency, deactivate one, delete one and
promote one to the shop's default. Nothing in this repository calls these
routes: the admin currency screen is `dictionaries`'
(`/api/v1/admin/dictionary/currencies/*`, gated on `dictionary.write`), which is
a second door to this table and a separate question.

`test/contract/currencies/permission-authority.test.ts` pins both directions —
a role holding the catalogue codes is refused, a role holding the pair is
served — and asserts that the in-process `currencyReadPort` every other module
reads a currency through is untouched by the move.

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
