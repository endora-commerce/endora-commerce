# Data model: three-level product scope model

**Feature**: `specs/168-product-editor-scope-switcher/` | Decisions: `research.md` (R#). Replaces the parts of
`specs/163-product-data-scopes/data-model.md` named per section below; 163's sections not named here stand.

Every catalog and seo table here is **platform-global** (`@GlobalEntity()`), as `products` is (163 FR-083,
Constitution XI); `import_profiles` is platform-global admin configuration. Migrations are **scaffolded, never
numbered** (`pnpm --filter backend run migration:new -- --module <id> --name <slug>`); the names are the `--name`
slugs of research R18. No migration preserves 163-model data beyond what keeps a dev database usable (FR-020);
none has a data-restoring `down`.

## 0. Scope vocabulary (contracts, R1)

| Term | Encoding |
| --- | --- |
| Scope | `{ level: 'global' }` · `{ level: 'channel', channelId }` · `{ level: 'channel_language', channelId, languageCode }` |
| Scope set of a field | subset of `G`, `C`, `CL` — `PRODUCT_FIELD_SCOPE_SETS` (table §9) |
| Scoped row | `{ channelId, languageCode: string \| null, value: { kind: 'value', value } \| { kind: 'empty' } }` — `languageCode null` = C |
| No override | no row at that scope → inherit |
| Empty override | a row whose value is `{ kind: 'empty' }` — stops the fallback (FR-013) |
| Source | `set` · `set_empty` · `inherited_channel` · `inherited_global` · `absent` (FR-109) |
| Write op | absent (no change) · `set(value)` · `empty` · `inherit` (FR-110, R3) |

Fallback: `effective(f, C, L) = row(f, C, L) ?? row(f, C, null) ?? global(f)`, restricted to the field's scope
set; a row present with `empty` is the answer. Valid scopes for a product: G; (C) for every member channel; (C, L)
for every member channel C and every L in C's languages (163 FR-014, `toScopeChannel`). Rows at other scopes are
**orphaned**: retained, ignored by resolution, listed by the overview (163 FR-015).

## 1. `products` (catalog) — migration `scope_model_texts`

| Column | Before (163) | After (168) |
| --- | --- | --- |
| `name` | jsonb `{lang: text}` | `text not null` — the Global name (FR-014) |
| `description` | jsonb `{lang: text}` | `text null` — the Global description; `null` = none |
| `attribute_values` | jsonb; a language-scoped attribute held a `{lang: value}` map | jsonb `{ key: scalar \| array }` — Global values only, never a language map |
| `admin_name_key_en`, `admin_name_key_pl`, `admin_search_key_en`, `admin_search_key_pl` | generated from the name map per admin language | **dropped** with `catalog_admin_display_name(jsonb, …)` and `catalog_admin_name_key(jsonb, …)` |
| `admin_name_key`, `admin_search_key` | — | generated stored `text collate "C"`: `catalog_admin_fold(coalesce(nullif(name,''), sku))` and `… || ' ' || lower(sku)`; indexes `products_admin_order` (btree `(admin_name_key, sku, id) include (admin_search_key)`) and `products_admin_search_trgm` (GIN trigram) |
| `updated_at` | ORM `onUpdate` | also the **version** (R7): bumped by every scoped write of the product, compare-and-set by the save and copy Commands |

Conversion (dev databases only): `name = coalesce(nullif(name->>'en-US',''), first non-empty value in key order,
sku)`; `description` likewise, `null` when none; a language-map attribute value collapses the same way. Other
languages are dropped (FR-020). Order inside the migration: drop indexes → drop generated columns → drop
functions → convert types → recreate one function pair over `text` → add generated columns → recreate indexes.
`catalog_admin_fold(text)` is kept.

`products.status`, `visibility`, `allowed_organization_ids`, `publish_from`, `publish_until`, `min_order_quantity`,
`returnable`, `slug` keep their meaning as the Global values (163 §3).

**Consequence for feature 161 (price-book paging).** The admin ordered walk and search read one key instead of
one per admin language; `pageProductsByAdminName`'s language argument is dropped. An admin sees the Global name
regardless of admin UI language (FR-031) — noted for the owner in `plan.md`.

## 2. `product_attributes` (catalog) — `scope_model_texts`

| Column | Change |
| --- | --- |
| `channel_scoped`, `language_scoped` | **dropped** |
| `scopable` | `boolean not null default false` (FR-012, R15). Conversion: `scopable = channel_scoped or language_scoped` |

Derived scope set (`attributeScopeSet(def)` in contracts): not scopable → `{G}`; scopable and value type
`string` (the only text type of `attributeValueTypeSchema`, `packages/contracts/src/catalog.ts:73`) →
`{G,C,CL}`; scopable and any other type (`number`, `price`, `boolean`, `date`, `enum`, `select`, `multiselect`) →
`{G,C}`. The required flag is the custom-field definition's (`custom_field_definitions`, feature 061) — read
through `CatalogAttributeReadService`, never from `custom_fields`' table.

## 3. `product_value_overrides` (catalog) — `scope_model_texts`

Shape unchanged (`id`, `product_id`, `attribute_key`, `channel_id`, `language_code null`, `value jsonb`, timestamps;
partial uniques `(product_id, attribute_key, channel_id) where language_code is null` and
`(product_id, attribute_key, channel_id, language_code) where language_code is not null`).

| Rule | Detail |
| --- | --- |
| Holds | C and C×L values of `name`, `description` and user attributes (`attribute_key`) |
| `value` | `{"v": <value>}`; **`{"v": null}` = empty override** (FR-013). CHECK `value ? 'v'` |
| C rows of `name` / `description` | **accepted** (FR-017; audit G1) |
| A C×L row for a {G,C} attribute | refused at write (FR-012); an existing one (after a type change) is orphaned |
| Absent row | inherit |

Conversion: none needed beyond the CHECK; existing rows are already C or C×L.

## 4. `product_channel_scopes` / `product_channel_language_scopes` (catalog) — `scope_model_order_rules`

163 §1–§2 stand, with:

| Column | Change |
| --- | --- |
| `min_order_quantity_overridden` | **new** `boolean not null default false` — the C row overrides the Global minimum |
| `min_order_quantity` | meaningful only when overridden; `null` = **no minimum in this channel** (round 5); else 1…1 000 000 |
| CHECK | `min_order_quantity_overridden or min_order_quantity is null`; old `1`-means-none rows converted to `overridden = true, value = null` |

Row deletion invariant (163 FR-012): a row whose every field inherits (`status null`, `window_overridden false`,
`visibility null`, `min_order_quantity_overridden false`, `returnable null`) is deleted.

## 5. URL keys and redirects (catalog) — `scope_model_url_keys` (replaces 163 §5)

`product_url_keys` (recreated)

| Column | Type | Null | Meaning |
| --- | --- | --- | --- |
| `id` | uuid | no | PK |
| `product_id` | uuid | no | FK `products` on delete cascade |
| `sales_channel_id` | uuid | no | FK `sales_channels` on delete cascade |
| `language_code` | varchar(16) | yes | `null` = the channel (C) key; else the C×L key |
| `key` | varchar(160) | no | `productSlugSchema` grammar |
| `created_at`, `updated_at` | timestamptz | no | |

Partial uniques: `(product_id, sales_channel_id) where language_code is null`;
`(product_id, sales_channel_id, language_code) where language_code is not null`. Index `(key)`.

`product_url_redirects` (recreated)

| Column | Type | Null | Meaning |
| --- | --- | --- | --- |
| `id` | uuid | no | PK |
| `product_id` | uuid | no | the product redirected to; FK `products` cascade |
| `sales_channel_id` | uuid | no | FK `sales_channels` cascade |
| `language_code` | varchar(16) | no | the (C, L) the redirect answers at |
| `key` | varchar(160) | no | the former key |
| `created_at` | timestamptz | no | |

Unique `(sales_channel_id, language_code, key)`. Write rules and resolution order: `contracts/url-keys.md`.
Conversion: every 163 language key (`sales_channel_id null`) and every redirect is dropped (FR-020).

## 6. Gallery (catalog) — `scope_model_media` (replaces 163 §7)

| Table / column | Change |
| --- | --- |
| `gallery_items.alt_text` | jsonb map → `text null` — the Global alt text; `null` = no product alt (the asset's own alt text is the derived fallback, 163 D3) |
| `gallery_items.hidden` | **new** `boolean not null default false` — hidden at Global |
| `gallery_item_labels` | unchanged — the Global role holders |
| `gallery_item_channel_labels`, `gallery_item_channel_hidden` | **dropped** |
| `gallery_item_scope_overrides` | **new** — §6a |
| `gallery_role_scope_overrides` | **new** — §6b |

§6a `gallery_item_scope_overrides`: `id uuid pk`, `gallery_item_id uuid not null` FK `gallery_items` cascade,
`product_id uuid not null` (FK `products` cascade; denormalised for the per-product read), `sales_channel_id uuid
not null` FK cascade, `language_code varchar(16) null`, `field varchar(16) not null` CHECK in (`alt_text`,
`hidden`), `value jsonb not null` CHECK `value ? 'v'`, timestamps. Partial uniques
`(gallery_item_id, field, sales_channel_id) where language_code is null` and
`(gallery_item_id, field, sales_channel_id, language_code) where language_code is not null`; index
`(product_id)`. `hidden` values are `{"v": true|false}` (no empty); `alt_text` `{"v": "<text>"|null}`.

§6b `gallery_role_scope_overrides`: `id uuid pk`, `product_id uuid not null` FK cascade, `sales_channel_id uuid not
null` FK cascade, `language_code varchar(16) null`, `label varchar(16) not null` (`base_image` / `small_image` /
`thumbnail`), `gallery_item_id uuid null` FK `gallery_items` on delete cascade — **`null` = empty override: no
image holds the role at this scope**. Partial uniques `(product_id, label, sales_channel_id) where language_code is
null` and `(product_id, label, sales_channel_id, language_code) where language_code is not null`.

Effective at (C, L): an item is shown unless its effective `hidden` is true; role R = effective holder of R; a
holder that is effectively hidden at (C, L) resolves to none (163 rule kept). Alt at (C, L) = effective alt; when it
is `absent` the asset's alt text in L applies (derived fallback); what an **empty** alt shows is owner question Q1.

## 7. Attachments and packaging units (catalog) — `scope_model_media` (replaces 163 §8)

| Table / column | Change |
| --- | --- |
| `product_attachments.name`, `.description` | unchanged — the Global values |
| `product_attachments.hidden` | **new** `boolean not null default false` — hidden at Global (round 2: attachment hidden gains G) |
| `product_attachments.name_translations`, `.description_translations` | **dropped** |
| `product_attachment_channel_hidden` | **dropped** |
| `product_attachment_scope_overrides` | **new**: as §6a with `attachment_id` FK `product_attachments` cascade and `field` in (`name`, `description`, `hidden`) |
| `product_packaging_units.name` | unchanged — the Global name (unique per product) |
| `product_packaging_units.name_translations` | **dropped** |
| `product_packaging_unit_scope_overrides` | **new**: as §6a with `packaging_unit_id` FK `product_packaging_units` cascade and `field` = `name` |

Snapshots (`cart_items.packaging_unit_name`, `quote_request_items.packaging_unit_name`, order lines) take the
effective name at the document's (C, L) through `effectivePackagingUnitNames` (163 N2 rule, new chain) and are
never re-resolved.

## 8. `seo_meta_overrides` (seo) — `product_meta_three_levels` (replaces 163 §6 for products)

| Change | Detail |
| --- | --- |
| delete | rows with `entity_type = 'product' and sales_channel_id is null and locale is not null` (Language scope, FR-010) |
| CHECK `seo_meta_overrides_scope` | replaced by: `entity_type = 'product' and (locale is null or sales_channel_id is not null)` **or** `entity_type <> 'product' and (locale is not null or sales_channel_id is not null)` |
| partial unique | add `(entity_type, entity_id) where sales_channel_id is null and locale is null` (one Global product row) |
| column semantics (product rows) | `NULL` = inherit (at G: no value); `''` = deliberately empty (R9) |

Category and CMS-page rows are unchanged (FR-117).

## 9. Field scope sets (contracts `PRODUCT_FIELD_SCOPE_SETS`, FR-011 / FR-012)

| Field path | Scope set | Required (refuses `empty`) | Empty allowed means |
| --- | --- | --- | --- |
| `name` | G, C, CL | **yes** | — |
| `description` | G, C, CL | no | no description |
| `status` | G, C, CL | n/a (select) | refused |
| `window` | G, C | no | `null` bound = no limit |
| `audience` | G, C | n/a (select) | refused |
| `minOrderQuantity` | G, C | no | no minimum here |
| `returnable` | G, C | n/a (boolean) | refused |
| `urlKey` | G, C, CL | **yes** | — |
| `attribute:<key>` scopable text | G, C, CL | if `isRequired` | no value |
| `attribute:<key>` scopable non-text | G, C | if `isRequired`; single select (`enum`, `select`) and `boolean` refuse always | `number` / `price`: no value · `date`: no limit · `multiselect`: nothing selected |
| `attribute:<key>` not scopable | G | if `isRequired` | — |
| `seo:title`, `seo:description`, `seo:ogTitle`, `seo:ogDescription`, `seo:ogImageUrl` | G, C, CL | no | owner question Q1 |
| `gallery:<itemId>:altText` | G, C, CL | no | owner question Q1 |
| `gallery:<itemId>:hidden` | G, C, CL | n/a (boolean) | refused |
| `galleryRole:<label>` | G, C, CL | no | no image holds the role |
| `attachment:<id>:name` / `:description` | G, C, CL | no | nothing shown |
| `attachment:<id>:hidden` | G, C, CL | n/a (boolean) | refused |
| `packagingUnit:<id>:name` | G, C, CL | no | nothing shown |

Every field not listed is global-only (spec *Terms*). `inherit` at G is refused for every field (FR-113).

## 10. `product_editor_preferences` (catalog) — no schema change (R8)

| `last_channel_id` | `last_language_code` | Scope |
| --- | --- | --- |
| `null` | `null` | Global |
| set | `null` | Channel |
| set | set | Channel × language |
| `null` | set | invalid — refused by the PUT route |

Emptied by `scope_model_texts` (the old `null` language meant "primary admin language").

## 11. `import_profiles` (import_export) — migration `import_profiles` (R14)

| Column | Type | Null | Meaning |
| --- | --- | --- | --- |
| `id` | uuid | no | PK |
| `name` | varchar(120) | no | unique (`lower(name)`) |
| `entity` | varchar(32) | no | `'products'` (CHECK) — the only entity with a mapping in 168 |
| `source_language_for_global` | varchar(16) | yes | the source locale written to Global (FR-047); `null` = none |
| `locale_mapping` | jsonb | no | `pimLocaleMappingEntriesSchema` — `[{ sourceLocale, sourceChannel, targets: [{ channelId, languageCode }] }]` |
| `created_at`, `updated_at` | timestamptz | no | |

No FK on target channel ids (a deleted channel makes a target invalid, reported per row at import — FR-042).
Commands `import_profile.create` / `.update` / `.delete`, before / after = the row projection.

## 12. Search document (search) — no migration; reindex (replaces 163 §11 text fields)

`IndexedDocument` drops `name`, `description`, `localizedNames`, `searchableOptions` and the text entries of
`attributes`, and gains `texts: Record<languageCode, { name: string; description: string; attributes:
Record<key, string>; options: string[] }>` — one entry per language the channel offers, each the effective text
at (C, L). `attributes` keeps non-text values. Settings: `searchableAttributes = ['sku', 'texts', 'attributes']`;
filterable fields of 163 unchanged.

## 13. State transitions

| Transition | Effect |
| --- | --- |
| Save at scope S | one Command; for each staged (field, S): `set` → upsert own value; `empty` → upsert empty row (refused for required / select / boolean); `inherit` → delete own row (refused at G); version bumped; one audit entry; one `product.updated.v1` with `changedFields` |
| Copy to channels | one Command; upsert the source's own value (or empty) at each (C_target, L); one audit entry |
| Product leaves a channel / channel drops a language | rows retained and ignored, listed as orphaned; orphaned URL keys keep reserving (FR-016, FR-018) |
| Attribute scopable → not scopable | every override row orphaned (previewed, 163 FR-090) |
| Attribute value type text → non-text | its C×L rows orphaned (C rows remain valid) |
| Gallery item / attachment / packaging unit deleted | its override rows removed by cascade |
| Channel deleted | rows removed by cascade |
| URL key at a scope replaced | redirect inserted at each (C, L) whose effective key changed (`contracts/url-keys.md`) |
