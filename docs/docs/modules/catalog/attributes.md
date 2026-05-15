---
title: Attributes
---

# Attributes

An **Attribute** is a single named property that can be attached to a
Product — `color`, `gear_ratio`, `material`, `weight`. Attributes
are the lower-level primitive consumed by everything that decorates a
product: the storefront filter sidebar, the PDP "Parametry produktu"
tab, the Compare page, the Promotion Rule editor, the search index,
and the configurable-product variant picker.

Attributes are grouped into [Attribute Sets](./attribute-sets.md) which
are then pinned to a Product so the admin editor renders just the
fields that family actually needs. This page covers the attribute
itself; the set ↔ product wiring lives on the Attribute Sets page.

## Anatomy

Every attribute carries:

| Field | Purpose |
| --- | --- |
| `key` | Stable, URL-safe identifier — `^[a-z][a-z0-9_]*$`, unique platform-wide (case-insensitive). Used in filter URLs, search payloads, and the product JSONB key. |
| `label` | `Record<bcp47-tag, string>` per-locale label map. |
| `labelDefault` | Fallback label used when the active storefront / admin locale is missing from `label`. |
| `valueType` | One of `string`, `number`, `boolean`, `price`, `date`, `select`, `multiselect`, `enum`. |
| `options[]` | Ordered list of selectable options — only for `select` / `multiselect` / `enum`. See [Option lists](#option-lists) below. |

Plus the behavioural flags and a numeric position:

| Flag | Default | Consumed by |
| --- | --- | --- |
| `isFilterable` | `false` | Storefront filter sidebar |
| `isSearchable` | `false` | Search indexer (Meilisearch) |
| `isComparable` | `false` | Storefront Compare page |
| `isVariantAxis` | `false` | Configurable-product variant picker |
| `isRequired` | `false` | Product-save validator (only when the attribute is in the assigned Attribute Set) |
| `isPromoRule` | `false` | Promotion Rule criterion picker |
| `isVisibleOnProductPage` | `false` | PDP "Parametry produktu" tab |
| `displayAsSlider` | `false` | Storefront sidebar — renders a range slider; only valid for `valueType ∈ ('number','price')` |
| `filterPosition` | `0` | Storefront sidebar sort key (ascending; ties broken alphabetically by the resolved label) |

## Value types

| Type | Storage | Notes |
| --- | --- | --- |
| `string` | string | Free-text. |
| `number` | number | Numeric; supports `displayAsSlider` for range filters. |
| `boolean` | boolean | Two-state. |
| `price` | number | Money amount — formatted in the active currency / locale. Supports `displayAsSlider`. |
| `date` | ISO 8601 date string | |
| `select` | option `value` | Single choice from `options[]`. At most one option may carry `isDefault = true`. |
| `multiselect` | array of option `value`s | Multiple choices from `options[]`. Any number of options may carry `isDefault = true`. |
| `enum` | option `value` | Same storage shape as `select`; renders as a compact pill / segmented control on storefront filters and the PDP rather than a dropdown. |

Changing `valueType` while any product carries a value the new type
cannot represent is refused with `attribute_type_change_unsafe` (FR-007).

## Option lists

For `select` / `multiselect` / `enum` attributes the option list is
authored inline on the attribute editor. Each option carries:

| Field | Purpose |
| --- | --- |
| `value` | Stable identifier — `^[a-z0-9_-]{1,200}$`, unique within the attribute. Encoded into filter URLs and stored on every product that carries that value. |
| `label` | `Record<bcp47-tag, string>` per-locale label map. |
| `labelDefault` | Fallback label when the active locale is missing from `label`. |
| `isDefault` | Optional pre-selection on new products. `select` / `enum` allow at most one; `multiselect` allows any number. |
| `sortOrder` | Render order; ties broken by `value` ASC. |

Option **values** are immutable while any product still carries them
(FR-026) — the operator must migrate dependent values first. Option
**labels** can always be renamed. Deleting an option is refused with
`409 option_in_use` while any product still carries that value
(FR-025).

## Public surface

Admin routes are gated by `catalog:read` (list / get) /
`catalog:write` (mutations).

| Verb + Path | Audience | Purpose |
| --- | --- | --- |
| `GET /api/v1/admin/catalog/attributes` | admin | List attributes |
| `GET /api/v1/admin/catalog/attributes/by-flag?flag=isPromoRule\|isComparable\|...` | admin | Picker payload — every attribute carrying the requested flag (US1) |
| `GET /api/v1/admin/catalog/attributes/:idOrKey` | admin | Single attribute read |
| `POST /api/v1/admin/catalog/attributes` | admin | Create attribute (accepts the flags + inline `options[]` for select-style types) |
| `PATCH /api/v1/admin/catalog/attributes/:key` | admin | Update labels and hot-toggle `isFilterable` / `isSearchable` / `isVariantAxis` / `isPromoRule` / `isComparable` / `isVisibleOnProductPage` / `isRequired` / `filterPosition`. Re-emits `attribute.updated.v1`. |
| `DELETE /api/v1/admin/catalog/attributes/:idOrKey` | admin | Delete; refused with `409 attribute_in_use_by_set` while any Attribute Set still references it |
| `GET /api/v1/admin/catalog/attributes/:idOrKey/options` | admin | List option rows for select / enum / multiselect attributes |
| `POST /api/v1/admin/catalog/attributes/:idOrKey/options` | admin | Append an option |
| `PATCH /api/v1/admin/catalog/attribute-options/:optionId` | admin | Patch `label` / `labelDefault` / `isDefault` / `sortOrder` (option `value` is immutable per FR-026) |
| `DELETE /api/v1/admin/catalog/attribute-options/:optionId` | admin | Remove; refused with `409 option_in_use` while any product still carries the value |

Filter sidebar reads consume `GET /api/v1/catalog/filters` (defined on
the [Catalog](../catalog.md) page) — that endpoint resolves the
currently visible filterable attributes per Sales Channel and orders
them by `filterPosition`.

## Errors

| Code | Status | When |
| --- | --- | --- |
| `attribute_key_invalid` | 400 | `key` does not match `^[a-z][a-z0-9_]*$` |
| `duplicate_key` | 409 | Attribute key already exists (case-insensitive) |
| `attribute_in_use_by_set` | 409 | Delete blocked: at least one Attribute Set still references the attribute |
| `attribute_type_change_unsafe` | 409 | `valueType` change refused — some product carries a value the new type cannot represent |
| `default_option_ambiguous` | 409 | More than one option flagged `isDefault = true` on a `select` / `enum` attribute |
| `option_in_use` | 409 | Delete (or value rename) blocked: a product still carries this option value |
| `attribute_not_found` | 404 | `:idOrKey` missing |
| `option_not_found` | 404 | `:optionId` missing |

## Storefront integration

### Filter sidebar (US5)

Category and search pages render a chip per `isFilterable` attribute
that has at least one value across the currently visible products.
Chips appear ordered by `filterPosition` ascending, ties broken
alphabetically by the resolved per-locale label. Attributes with no
values across the current page are omitted (no empty filter).

### PDP "Parametry produktu" tab (US6)

Every PDP carries a `Parametry produktu` tab that lists every
attribute meeting both:

- the product has a value for the attribute, **and**
- the attribute is flagged `isVisibleOnProductPage = true`.

For `select` / `multiselect` / `enum` values the tab renders the
option's per-locale label, not the raw `value`. The detail payload
field is assembled by `CatalogQueryService.buildVisibleAttributesProjection()`.

### Search index (US7)

Toggling `isSearchable` propagates into the Meilisearch indexer's
payload on the next refresh cycle. Textual types (`string`, plus the
option labels of `select` / `multiselect` / `enum`) feed the lexical
and (when enabled) semantic index; numeric / boolean / price / date
types feed range / exact-match filters.

### Compare page

Comparison rows on the storefront Compare page list every attribute
flagged `isComparable = true` for which at least one product in the
comparison carries a value. The list is sourced via
`CatalogQueryService.comparableAttributeKeys()` (feature 007).

### Variant picker

Configurable products expose a variant picker whose axes come from the
attributes flagged `isVariantAxis = true` on the product's currently
assigned Attribute Set.

## Storage

`product_attributes` (foundation 001 + feature 002 + feature 012):

- `id uuid PK`, `key varchar(64)` UNIQUE on `LOWER(key)`,
  `label jsonb`, `label_default varchar(200) NOT NULL`,
  `value_type varchar(16)` (`string` | `number` | `boolean` | `price`
  | `date` | `select` | `multiselect` | `enum`).
- Boolean flags: `is_searchable`, `is_filterable`, `is_variant_axis`,
  `is_comparable`, `is_required`, `is_promo_rule`,
  `is_visible_on_product_page`, `display_as_slider`.
- `filter_position int NOT NULL DEFAULT 0`.
- Partial index `(filter_position) WHERE is_filterable = true` keeps
  the storefront filter sort cheap.
- The legacy `enum_values jsonb` column was dropped by migration `032`
  after every row migrated into `attribute_options`.

`attribute_options` (feature 012, migration `032`):

- `id uuid PK`, `attribute_id uuid` FK → `product_attributes.id`
  ON DELETE CASCADE.
- `value varchar(200) NOT NULL`, `label jsonb NOT NULL`,
  `label_default varchar(200) NOT NULL`,
  `is_default boolean NOT NULL DEFAULT false`,
  `sort_order int NOT NULL DEFAULT 0`.
- UNIQUE `(attribute_id, value)`.
- Partial index `(attribute_id) WHERE is_default = true` supports the
  "find the default option" reads cheaply.

`products.attribute_values jsonb` carries the per-product map keyed by
attribute `key`. Values are retained server-side even when the
attribute leaves the product's currently assigned Attribute Set
(FR-012) — switching back surfaces them again.

## Events emitted

- `attribute.updated.v1` — picked up by the search indexer and
  bridged to webhook subscribers.

## Audit log

Attribute and option CRUD writes one `AuditLogEntry` per mutation
with `stateBefore` and `stateAfter` so the audit page surfaces who
flipped which flag.

## Cross-module consumers

Three methods on `CatalogQueryService` are the documented service
ports per Constitution I:

- `comparableAttributeKeys(): string[]` — feature 007 (Compare).
- `promoRuleAttributeKeys(): string[]` + `getAttributeWithOptions(key)`
  — feature 012 / US8 (Promotion Rule criterion picker and resolver).
- `buildVisibleAttributesProjection()` — internal, used by the PDP
  detail response to assemble the `visibleAttributes[]` payload.

## See also

- [Attribute Sets](./attribute-sets.md) — bundling attributes into
  per-family schemas pinned to a Product.
- [Catalog](../catalog.md) — the parent module, including the
  storefront `GET /api/v1/catalog/filters` endpoint that consumes
  `filterPosition`.
- [Search](../search.md) — the Meilisearch indexer that consumes the
  `isSearchable` flag.
- [Promotions](../promotions.md) — the Promotion Rule editor that
  consumes the `isPromoRule` flag.
