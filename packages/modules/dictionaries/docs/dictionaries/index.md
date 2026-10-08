---
title: Dictionary
sidebar_position: 1
description: Seeded reference data — Countries, Currencies, Languages — with admin reordering
---

# Dictionary

The Dictionary module is the platform registry for country, currency, and
language codes. It gives operators one Admin UI for the common reference data
used by addresses, tax rules, warehouses, sales channels, promotions,
megamenu bindings, and blog language scopes.

The module does not replace the legacy Languages and Currencies HTTP surfaces.
Those endpoints stay available for backward compatibility, while new admin and
storefront work should read through the Dictionary module.

## Operator Workflow

Open `Admin -> Operations -> Dictionary`. The page has three tabs:

- **Countries** — ISO country code, active flag, storefront visibility, default
  label, localized labels, and allowed languages for each country.
- **Currencies** — ISO currency code, symbol, decimal precision, active flag,
  storefront visibility, default label, and localized labels.
- **Languages** — every ISO 639-1 language plus the regional BCP-47 tags the
  shop adds: code, English and native name, the countries that use it, active
  flag, default label, and localized labels.

Deactivating an entry prevents new writes from selecting that code, but
historical records can keep reading the existing value. This is intentional:
orders, addresses, content scopes, and configuration records must remain
auditable after a code is retired from active use.

Localized labels are edited from each row. Storefront registry reads choose the
requested locale when present and fall back to the default label when a
translation is missing.

## The Language Catalogue

The Languages tab lists every ISO 639-1 language — 183 two-letter codes —
beside the two regional languages the platform ships with, `en-US` and `pl-PL`.
Each language carries the countries that use it, shown as country-code chips.
The list can be searched by code, name or country, filtered by status, and is
paged.

**A listed language is available, not active.** The catalogue arrives inactive.
Only an active language is offered to sales channels, appears in the storefront
registry and in `GET /api/v1/i18n/config`, and can receive a translated label.
Activate a language on its row to start using it. A regional tag the catalogue
does not hold, such as `de-AT` or `pt-BR`, is still created with **Add
language**.

The catalogue is reference data seeded when the backend boots, so an
installation that predates it receives it on its first boot after the upgrade.
Seeding only inserts what is missing: a row you have edited or activated is
never overwritten, and a seeded row you delete returns on the next boot — leave
it inactive instead. A language is linked only to countries the Countries tab
holds; add a country and its languages are linked on the next boot.

## Storefront Registry

Storefront clients read the combined registry through:

```http
GET /api/v1/dictionary?locale=pl-PL
```

The response contains only entries that are active and visible on the
storefront. It is cached in Redis when Redis is available. Admin writes and the
operator cache-invalidation endpoint clear that registry cache.

Use the registry for UI pickers instead of hard-coded country, currency, or
language lists. The module ships shared picker components for admin and
storefront code paths.

## Validator Port

Backend consumers receive the shared validator from the composition root:

```ts
dictionaryValidator: dictionaries.handle.validator
```

The port exposes:

- `validateCountryCode(code, mode)`
- `validateCurrencyCode(code, mode)`
- `validateLanguageCode(code, mode)`

Use `create-or-change` for a new code assignment. Use `unchanged` only when an
update keeps the same historical code already stored on that record. Unknown
codes are always rejected. Inactive codes are rejected for new assignments and
accepted only for unchanged historical values.

The validator has a short in-process LRU. Dictionary writes invalidate the LRU
and Redis registry cache together.

## Extension Points

When a module stores a country, currency, or language code:

1. Accept the validator through the module plugin options.
2. Validate at the service boundary before writing.
3. Convert `DictionaryReferenceError` into a `409` response with the affected
   field path.
4. Preserve historical reads; do not cascade-edit consumer rows when a
   dictionary entry is deactivated.

Settings currently has no typed country/currency/language setting value kind,
so its dictionary validator option is reserved for future metadata-driven
settings.
