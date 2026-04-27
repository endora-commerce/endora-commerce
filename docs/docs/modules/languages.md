---
title: languages
---

# `languages`

The installation-wide pool of supported BCP-47 language tags (T238 /
FR-105). Owns the public `i18n/config` read path that storefront + admin
consume to render their language pickers, plus a small
`LocaleService` that implements the FR-105 translation-fallback rule.

## Public surface

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/i18n/config` | storefront / admin | Active languages + currencies + the configured defaults |
| `GET /api/v1/admin/languages` | admin | Full list, including inactive rows |
| `PUT /api/v1/admin/languages/:code` | admin | Upsert |
| `POST /api/v1/admin/languages/:code/default` | admin | Promote to default (atomically demotes the prior default) |
| `DELETE /api/v1/admin/languages/:code` | admin | Remove (rejected for the default) |

The same shape is exposed for currencies under `/api/v1/admin/currencies`;
see [currencies](./currencies).

## Defaults

Exactly zero or one row in `languages` has `is_default = true`,
enforced by a partial unique index on `(is_default) WHERE is_default =
true`. Setting a new default runs the demote-then-promote pair inside one
MikroORM transaction so the partial unique index is never violated
mid-flight.

The `LanguageService.setDefault()` rejects rows where `isActive=false`
(`409 VALIDATION_FAILED`), and the `remove()` path refuses to delete a
row that is currently the default.

## Bootstrap

Migration 012 inserts two rows so quickstart works without an admin step:
- `en-US` — default, active
- `pl-PL` — active

The customer-facing `label` and `symbol` (currencies) values are written
with Postgres `U&'…'` Unicode literals so the migration source file stays
ASCII-only (Constitution Principle VIII applies to engineering artifacts;
the runtime row reflects what the storefront should render).

## Translation-fallback (`LocaleService`)

`LocaleService.pickLocalizedValue(record, requestedLocale, defaultLocale?)`
implements the FR-105 lookup chain:

1. requested locale, if present in the record.
2. configured default locale, if supplied and present.
3. first present value in the record.
4. empty string.

`resolveRequestLocale(acceptLanguageHeader, activeLocales)` parses an
`Accept-Language` header (q-weighted) and returns the highest-priority
match from the active language pool, with a language-only fallback so
`en-GB` matches `en-US`. Falls back to the configured default when nothing
matches.

The default-locale lookup is cached for 60 seconds; admin mutations call
`invalidateDefault()` so the cache flushes immediately after a change.

## Entities

`Language` — natural primary key on the BCP-47 code; `label`,
`isDefault`, `isActive`, `sortOrder`.

## Extension points

- **Per-Sales-Channel default** — when a Sales Channel ships its own
  language, hook the resolver before
  `LocaleService.resolveRequestLocale()` and use the channel's default
  instead of the global one.
- **Translation pull/push** — emit a domain event when a localized field
  changes and let an integration consume it for an external translation
  workflow.
