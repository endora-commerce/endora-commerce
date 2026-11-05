---
title: Per-channel + per-language overrides
---

# Per-Channel + Per-Language Overrides

The Catalog uses a **four-scope value model** for product attribute
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

The same scopes also decide **where a product is available**: its status,
publication window, audience and order rules can differ per Sales Channel,
and its status per channel × language. That is described in
*Availability per sales channel and language* below. A product's URL keys per
language and per channel × language have their own page,
[URL Keys and Redirects](./url-keys-and-redirects.md).

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

These consumers go through the resolver:

- **Admin endpoint** — `GET /api/v1/admin/catalog/products/:id?channelId=&languageCode=&includeOverridesMap=true`
  returns the baseline product PLUS, when context params are passed, a
  `resolved` block with `name`, `description`, `attributeValues`,
  `sources`. When `includeOverridesMap=true`, the full override list
  is attached for client-side switcher previews.
- **Storefront public read** — pulls the channel from the
  `x-sales-channel` header (the existing convention) and
  the language from `Accept-Language`, else the channel's default
  language. The override layer is invisible to the public client: it
  receives the effective value. The product page (name, description,
  SEO fields, attribute values, the product-page attribute list, grouped
  children and bundle options) and every listing card walk the storefront's own baseline language pick — requested
  language, then the channel's default language, then `en-US`, `en` and
  the first stored language — and at each language take the
  `(channel + language)` slot if it is filled, else stop there if the
  baseline has text for that language. An override therefore answers
  only for the language whose baseline text the page would show, or an
  earlier one in that order: a request in `en-US` on a channel whose
  default is `pl-PL` shows the `en-US` baseline, not the `pl-PL`
  override, while a `de-DE` request for a product with no `de-DE` text
  falls through to `pl-PL` and shows its override. The `(channel-only)`
  slot is asked last and wins over the baseline wherever the walk
  stopped. Product-link tiles keep their own language pick, which has
  no channel-default leg, and walk the override slots over it, so a
  tile can show the `en-US` baseline where the listing card shows the
  channel default's override. A product without overrides shows exactly what
  it showed before. On the listing's Postgres path, `sort=name` orders by
  the effective name at the request's channel and language (ties by id),
  free text `q` matches the effective name and the effective values of
  searchable attributes, and `filter[attr.*]` and the facet counts use the
  channel's effective values at the request language. When the `search`
  module answers the listing, it sorts by the name indexed in the channel's
  default language (see the `search` module's page).
- **Search indexer (Meilisearch)** — builds one document per
  `(product, channel)` pair. Each document's `name` and `description`
  fields are run through the resolver with `channel.defaultLanguage`
  as the active language, so per-channel overrides flow into
  storefront search ranking and name sorting.
- **Search result cards** — the search module re-reads every hit from
  Postgres before it answers, and the card name it shows is resolved
  there, not taken from the index: the request's sales channel override
  rows are read once per results page and the card walks the same
  languages and slots, in the same order, as a listing card above. The indexed name is
  resolved for the channel's default language only, so it would be
  wrong for a request in any other language. A product without an
  override for the channel shows exactly what it showed before.

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
4. Offers "Add override" / "Edit override" / "Use inherited"
   affordances per field. Edits go through `PATCH /value-overrides`
   with optimistic refresh.
5. Persists the editor's `(channel, language)` selection back via
   `PUT /editor-preference` (debounced, best-effort) so the next visit
   seeds the same context.

Edit affordances are gated on a specific channel being selected.
Under Global / no channel, the panel is read-only and a help string
explains that overrides only apply per-channel.

## Availability per sales channel and language

A product is **available** to a buyer at a sales channel C and language L when
all of these hold:

1. it is a member of C and not archived;
2. its effective **status** at (C, L) is `active`;
3. now is inside its effective **publication window** (both ends included);
4. its effective **audience** admits the buyer.

L is the first `Accept-Language` tag of the request matched to C's languages,
else C's default language. Every buyer-facing read asks this one rule — the
listing and its price range, facet and category counts, the product page,
product links, grouped children and bundle options, the quick search, search,
the sitemap, product feeds — and so do the places a product is acquired: the
basket, checkout and placement, quote requests, quick order and the external
order intake. A product that is not available answers exactly as a product
that does not exist (`404 PRODUCT_NOT_FOUND`); whether one exists, is off, is
outside its window or is restricted cannot be told apart. An archived product
is the exception described under *Product status and archiving* on the
[Catalog](../catalog.md#product-status-and-archiving) page.

### Scopes and inheritance

| Field | Global | Sales channel | Channel × language |
| --- | --- | --- | --- |
| Status (`active` / `inactive`) | `products.status` | yes | yes |
| Publication window | `products.publish_from` / `publish_until` | yes | — |
| Audience (visibility and organisations) | `products.visibility` / `allowed_organization_ids` | yes | — |
| Minimum order quantity, returnable | `products` | yes | — |

Each field takes the value of the most specific scope that sets one: for the
status, channel × language, then channel, then global; for the others,
channel, then global. An unset scope **inherits** — there is no "empty"
value that switches something off. A product with no overrides behaves
exactly as before.

- **Status.** `inactive` at any scope is plain off there, and archiving is not a
  status — see *Product status and archiving* on the
  [Catalog](../catalog.md#product-status-and-archiving) page. A product off
  globally and `active` in one channel is available in that channel only.
- **Publication window.** `from` and `until`, each optional (an open side);
  both ends are included. A channel window replaces the global window as a
  pair, even when both its sides are open. A window that does not start before
  it ends is refused with `422 VALIDATION_FAILED` (`details.field = 'window'`).
  The window is evaluated when a request is answered; nothing is written when
  it opens or closes. A sweep (`catalog.publication-window.sweep`, every five
  minutes) announces `product.updated.v1` with
  `changedFields: ["publicationWindow"]` for each product whose window bound
  was crossed, so caches and the search index catch up.
- **Audience.** The visibility mode and the organisation list are one value:
  a channel's audience replaces the global rule whole, never merged with it.
  Naming organisations that are not members of the channel is allowed and
  answered with an `audience_non_members` warning.
- **Order rules.** See *Per sales channel* under *Order rules* on the
  [Catalog](../catalog.md#per-sales-channel) page.

An override is honoured only where it can apply: one for a channel the product
has left, or for a language the channel no longer offers, is kept but ignored,
and listed as an orphan (below) until it is removed.

### Writing the scopes

`GET /api/v1/admin/catalog/products/:id/scopes` (`catalog:read`) answers the
global values and, per channel, the overrides, the channel's languages and
whether the product is still a member. `PATCH` on the same path
(`catalog:write`) writes them:

```json
{
  "channels": [
    {
      "channelId": "<retail-uuid>",
      "status": "active",
      "window": { "from": "2026-11-01T00:00:00Z", "until": null },
      "audience": null,
      "languageStatuses": [{ "languageCode": "de-DE", "status": "inactive" }]
    }
  ],
  "global": { "publishUntil": "2026-12-31T23:59:59Z" }
}
```

An absent key is left as it is; `null` removes the override (use inherited).
A value for a channel the product is not in, or a language the channel does not
offer, is refused with `422 SCOPE_INVALID`; removing such an override is always
allowed. The global window can also be written with the product `PATCH`
(`publishFrom`, `publishUntil`).

Each request is one audited Command, `product.scopes.update`; sending its
before-state back through the same route restores it. The write announces
`product.updated.v1` with `changedFields` among `scopedStatus`,
`publicationWindow`, `audience` and `orderRules`. A status change that switches
the product on is subject to the completeness check — see the
[Catalog](../catalog.md#completeness-check-when-switching-a-product-on) page —
and `warnings` carries what it found. Imports and connectors write the same
scopes through `catalogProductScopeWritePort`, unchecked; the field-by-field
table is on the [URL Keys and Redirects](./url-keys-and-redirects.md#integrations)
page. Setting one channel's status on many products at once is the bulk edit's
*Status per channel and language* — see the
[Catalog](../catalog.md#status-per-channel-and-language-in-bulk) page.

In the product editor these are the **scope controls** under the channel
switcher on the Details tab (status per channel and per language, window,
audience) and **Order rules per channel** on the Inventory tab; all are
read-only without `catalog:write`.

### Scope overview

`GET /api/v1/admin/catalog/products/:id/scope-overview` (`catalog:read`) lays a
product out as its channels × languages, and the product editor's **Scopes**
tab shows it. Each cell carries:

- the effective status and where it comes from (`channel_language`,
  `channel` or `global`);
- whether the product is available there now — a member, the language offered,
  on, inside its window, not archived; the audience is shown as a rule, not
  evaluated for anybody;
- every field overridden at that cell and the level it comes from — `status`,
  `window`, `audience`, `minOrderQuantity`, `returnable`, `name`,
  `description`, `attribute:<key>`, `urlKey`, and the media, attachment,
  packaging-unit and SEO fields set per channel or language;
- `missing` — what the completeness check would report there, whatever the
  cell's status.

Overrides that no longer apply are listed under `orphans` with a reason:
`not_a_member`, `language_not_offered` or `attribute_scope_changed`. On the
Scopes tab a scope value, a value override or a URL key is returned to the
inherited value with **Use inherited** where it is set — a channel's own values
in its "Whole channel" column, a language's own values in the "Every channel"
row — and an orphan (listed under **No longer applies**) is deleted; the tab
calls the endpoint that owns the value (`…/scopes`, `…/value-overrides` or
`…/url-keys`). Resetting a text value (a name, a description, a URL key, an SEO
field) and deleting an orphan ask first, naming the field and the scope; other
values reset in one click. A product in no sales channel answers no channels and
every active platform language.

Before an attribute's `channelScoped` or `languageScoped` flag is turned off,
`GET /api/v1/admin/catalog/attributes/:idOrKey/scope-change-preview?channelScoped=&languageScoped=`
answers how many value overrides would stop applying, in total and per
channel. The change keeps the rows; they become orphans.

### Storage

`product_channel_scopes` holds one row per product and channel with the status,
window, audience, minimum order quantity and returnable flag (`NULL` inherits);
`product_channel_language_scopes` holds the status per channel × language.
Both cascade on the product's and the channel's delete
(`20261022T035133_catalog_product_scopes.ts`, with the global window columns
`products.publish_from` and `publish_until`; no backfill).

## Migration

One migration `20260611T140346_catalog_product_value_overrides_init.ts` ships everything:

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
- **Channel-aware reindex enqueue** — the PATCH endpoint does not
  yet enqueue a Meilisearch reindex job per touched channel; the
  next per-product upsert (driven by any catalog mutation) picks it
  up. A dedicated reindex on override write is a small follow-up.
