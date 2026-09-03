---
title: Per-Channel + Per-Language Overrides
---

# Per-Channel + Per-Language Overrides

Feature 022 introduces a **four-scope value model** for product attribute
values. The same attribute key can hold up to four addressable slots
per product:

- `global` — one value across every Sales Channel and every language;
- `language` — one value per language (e.g. system Name, Description);
- `channel` — one value per Sales Channel the product is assigned to;
- `channel+language` — one value per `(channel, language)` pair.

Which slots are addressable for a given attribute is governed by two
flags on the attribute definition, `channelScoped` and `languageScoped`.
System attributes `name` and `description` are pinned channel-scoped +
language-scoped via a backend constant
(`SYSTEM_ATTRIBUTE_SCOPES`). User-defined attributes default to
global-only and opt in via the attribute editor.

## Why

A B2B catalog routinely needs to overlay channel-specific marketing
copy (wholesale vs. retail) and language-specific translation on the
same product. The legacy storage — JSONB on `products.name` /
`products.description` + a flat `products.attribute_values` JSONB —
could express only the language dimension. The four-scope model lifts
that ceiling without rewriting baseline storage; it adds a sibling
overrides table that holds the channel-aware slots, and a single
resolver function fuses the two on read.

## Storage shape

The global baseline keeps living where it has always lived:

- `products.name` (`Record<lang, string>` JSONB) — language-scoped.
- `products.description` (`Record<lang, string>` JSONB) — language-scoped.
- `products.attribute_values` (`Record<key, value>` JSONB) — global by
  default. When the attribute's `languageScoped` flag is `true`, the
  inner value is itself keyed by language: `Record<key, Record<lang,
  value>>`.

Channel-aware slots land in a new table:

```sql
create table "product_value_overrides" (
  "id"            uuid primary key default gen_random_uuid(),
  "product_id"    uuid not null references "products"("id") on delete cascade,
  "attribute_key" varchar(64) not null,
  "channel_id"    uuid not null references "sales_channels"("id") on delete cascade,
  "language_code" varchar(16) null,
  "value"         jsonb not null,         -- always wrapped { "v": <scalar | object> }
  "created_at"    timestamptz not null default now(),
  "updated_at"    timestamptz not null default now()
);
```

The (product, attribute, channel, language) tuple is unique under
**two partial indexes**:

```sql
create unique index "product_value_overrides_channel_only_uniq"
  on "product_value_overrides" ("product_id", "attribute_key", "channel_id")
  where "language_code" is null;

create unique index "product_value_overrides_channel_lang_uniq"
  on "product_value_overrides" ("product_id", "attribute_key", "channel_id", "language_code")
  where "language_code" is not null;
```

PostgreSQL treats `NULL` as distinct in a regular UNIQUE constraint, so
the only correct way to model "(channel, NULL) and (channel, NULL) are
the same row" is two partial indexes — one for each NULL semantic.

The lookup path used by the resolver in tight loops is a plain btree:

```sql
create index "product_value_overrides_product_attr_idx"
  on "product_value_overrides" ("product_id", "attribute_key");
```

A second table — `product_editor_preferences` — stores the per-(admin
user, product) last-selected `(channelId, languageCode)` so the
product edit page seeds the switchers from the editor's prior visit.
It carries no FK to `sales_channels` so a deleted / un-assigned
channel is silently tolerated on read.

## The resolver

The single source of truth for "what value should I show?" lives in
`packages/contracts/src/product-value-resolver.ts`. The same TypeScript
file is imported by the backend (admin endpoints, storefront read
path, search indexer) and the admin SPA. By construction, the admin's
effective-value preview cannot drift from what the storefront renders.

The algorithm — `resolveAttribute({ baseline, overrides, scope, ctx })`
— walks four steps:

1. `(channel + language)` slot — when the attribute is channel-scoped
   AND language-scoped AND the context carries both;
2. `(channel-only)` slot — when channel-scoped AND a channel is in the
   context;
3. `(global + language)` baseline — for language-scoped attributes,
   pick the requested language out of the JSONB;
4. `(global)` baseline — single value (or primary-language pick for
   language-scoped attrs).

The first non-empty slot wins. Empty string, `null`, empty object,
empty array are all treated as "absent" and fall through. The function
returns both the resolved value AND a `source` tag indicating which
slot produced the answer — the admin UI consumes this to render the
"channel + language override" / "global baseline" badge per field.

### Orphan tolerance

An administrator can flip an attribute's `channelScoped` flag back to
`false` after channel overrides have already been written. The
resolver simply skips override rows whose attribute is no longer
channel-scoped, so the storefront falls back to the baseline without
any data-loss event. A future maintenance pass can drop orphan rows;
this feature does not require it.

## Write path

Channel-aware overrides land through one admin endpoint:

```
PATCH /api/v1/admin/catalog/products/:id/value-overrides
{
  "upserts": [
    { "attributeKey": "name",        "channelId": "<vip-uuid>", "languageCode": "en-US", "value": { "v": "VIP wholesale name (EN)" } },
    { "attributeKey": "description", "channelId": "<vip-uuid>", "languageCode": "pl-PL", "value": { "v": "Wholesale-only Polish copy" } }
  ],
  "deletes": [
    { "attributeKey": "description", "channelId": "<retail-uuid>", "languageCode": "en-US" }
  ]
}
```

All requested operations run in a single `em.transactional` pass.
The handler validates every entry up front against six rules and
rolls everything back on the first failure:

| 422 code                            | Triggered when |
| ----------------------------------- | -------------- |
| `attribute_unknown`                 | `attributeKey` is neither a system attr (`name`, `description`) nor a row in `product_attributes`. |
| `attribute_not_channel_scoped`      | the attribute's `channelScoped=false`, so it has no channel slot. |
| `attribute_missing_language`        | the attribute's `languageScoped=true`, but the slot has `languageCode=null`. |
| `channel_not_assigned_to_product`   | `channelId` is not in `sales_channel_products` for the product. |
| `language_not_in_channel`           | `languageCode` is non-null and not in the channel's `SalesChannel.languages` array. |
| `value_invalid`                     | the wrapped `value.v` does not match the attribute's `valueType`. |

The baseline write path (Name / Description per language; global
`attribute_values`) is unchanged — editors still use the existing
locale-side-by-side inputs on the Details tab. Channel overrides are
additive.

## Read paths

Three consumers go through the resolver:

- **Admin endpoint** — `GET /api/v1/admin/catalog/products/:id?channelId=&languageCode=&includeOverridesMap=true`
  returns the baseline product PLUS, when context params are passed, a
  `resolved` block with `name`, `description`, `attributeValues`,
  `sources`. When `includeOverridesMap=true`, the full override list
  is attached for client-side switcher previews.
- **Storefront public read** — pulls the channel from the
  `x-sales-channel` header (existing convention from feature 006) and
  the language from `Accept-Language`. The override layer is invisible
  to the public client.
- **Search indexer (Meilisearch)** — builds one document per
  `(product, channel)` pair. Each document's `name` and `description`
  fields are run through the resolver with `channel.defaultLanguage`
  as the active language, so per-channel overrides flow into
  storefront search ranking.

## Admin UI

The product edit page's **Details** tab gains a
`<ProductScopeEditor>` panel above the existing locale inputs. It:

1. Loads `GET /scope-context` (channels assigned to the product + each
   channel's languages + the platform primary admin language + the
   editor's remembered preference) and `GET /value-overrides` in
   parallel.
2. Renders a Sales Channel switcher (Global + each assigned channel)
   and a Language switcher narrowed to the active channel's languages
   (or the union of all channel languages when Global).
3. Shows the resolved Name + Description for the active context with a
   source badge per field — `channel + language override` / `channel
   override` / `global baseline (language)` / `global baseline
   (fallback)` / `no value`.
4. Offers "Add override" / "Edit override" / "Reset to Global"
   affordances per field. Edits go through `PATCH /value-overrides`
   with optimistic refresh.
5. Persists the editor's `(channel, language)` selection back via
   `PUT /editor-preference` (debounced, best-effort) so the next visit
   seeds the same context.

Edit affordances are gated on a specific channel being selected.
Under Global / no channel, the panel is read-only and a help string
explains that overrides only apply per-channel.

## Migration

One migration `043_product_value_overrides_init.ts` ships everything:

- adds `channel_scoped` + `language_scoped` boolean columns to
  `product_attributes` (default `false`);
- creates `product_value_overrides` with the two partial UNIQUE
  indexes and the `(product_id, attribute_key)` btree;
- creates `product_editor_preferences` (composite PK
  `(admin_user_id, product_id)`).

No baseline data migration. No data backfill. The `down()` is the
exact inverse — drop the two tables and the two columns.

## What is not in scope

- **User-defined attribute overrides in the admin UI** — the panel
  surfaces only the system Name + Description today. User attribute
  overrides are accepted by the PATCH endpoint and resolved on read,
  but the admin SPA does not yet expose a write affordance for them.
- **Storefront public read shape change** — `products.name` and
  `products.description` still ship as `Record<lang, string>` JSONB
  on the public catalog endpoint. Switching to a resolved scalar is
  a breaking change for storefront consumers and is scoped as a
  follow-up.
- **Channel-aware reindex enqueue** — the PATCH endpoint does not
  yet enqueue a Meilisearch reindex job per touched channel; the
  next per-product upsert (driven by any catalog mutation) picks it
  up. A dedicated reindex on override write is a small follow-up.
