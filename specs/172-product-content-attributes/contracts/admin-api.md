# Contract: admin API — content attributes and product content

**Owner**: `catalog` (`packages/modules/catalog/src/backend/routes.admin.ts`). Every route is
registered through `ctx.routes`, so the module-route gate applies (Principle XVII; `catalog` is
`nonDeactivatable`, so it never answers `MODULE_DISABLED`). Gates are the route's `preHandler`
(`module-admin-surfaces.md` item 3). **No new permission code** (FR-023).

Error envelope: the platform's (`{ error: { code, message, details?, requestId } }`).

## 1. Attribute create / update (changed)

`POST /api/v1/admin/catalog/attributes` · `PATCH /api/v1/admin/catalog/attributes/:idOrKey`
(`catalog:write`, existing).

- `type: 'page_builder'` (and legacy `valueType: 'page_builder'`) is accepted.
- For a `page_builder` attribute — on create, and on update judged against the **stored** type
  with the patch applied:

| Request | Answer |
| --- | --- |
| any of `isSearchable`, `isFilterable`, `isVariantAxis`, `displayAsSlider`, `isComparable`, `quickSearchable`, `isPromoRule`, `isPriceRule`, `massEditable`, `isVisibleOnProductPage`, `channelScoped`, `isRequired` = `true` | `400 VALIDATION_FAILED`, `details: [{ path: '<flag>', issue: 'not available for Page Builder content' }]` — one entry per offending flag; nothing stored |
| `languageScoped: false` | same, `path: 'languageScoped'` |
| `languageScoped` omitted on create | stored `true` |
| `options` / `enumValues` non-empty | `400 VALIDATION_FAILED` (`options_forbidden` from the apply seam) |
| `type` change to or from `page_builder` | `409 VALIDATION_FAILED`, message `The value type of a Page Builder content attribute cannot be changed.` |

- Response shape unchanged; `type` and `valueType` read `page_builder`.
- Audit: unchanged actions (`catalog.attribute.create` / `.update`).

## 2. Attribute usage (new)

`GET /api/v1/admin/catalog/attributes/:idOrKey/usage` — `catalog:read`.

```jsonc
// 200
{ "data": { "attributeSetCount": 0, "productValueCount": 0, "productContentCount": 12 } }
```

- `attributeSetCount`: rows in `attribute_set_attributes` for the definition.
- `productValueCount`: distinct **non-deleted** products (`deleted_at is null`) that hold a value
  for the key — in `products.attribute_values`, in `product_value_overrides`, or in a variant's
  `variant_attribute_values`. It is the **same query** the delete guard runs (research R-21), so
  the dialog and the refusal cannot disagree.
- `productContentCount`: rows in `product_content_values` for the attribute whose product is not
  soft-deleted. Always `0` for a non-content attribute.
- `404 NOT_FOUND` for an unknown attribute.
- Answers for every attribute type (OR-5).

## 3. Attribute delete (changed behaviour, every type — OR-5, research R-21)

`DELETE /api/v1/admin/catalog/attributes/:idOrKey` — `catalog:write`, existing, any attribute type.

| Condition | Answer |
| --- | --- |
| still a member of ≥ 1 attribute set | `409 VALIDATION_FAILED` (unchanged) |
| `productValueCount > 0` (baseline value, channel override or variant value on a non-deleted product) | `409 VALIDATION_FAILED`, message names the count (overrides and variant values are **new** refusals; soft-deleted products **no longer** count) |
| otherwise | `204`; in the same `catalog.attribute.delete` Command: the attribute's `product_content_values` rows are deleted (`before.productContentCount` = N), then the extension, then the definition and its options (apply seam). One audit row. |

After commit:
- **New**: the Command emits `attribute.updated.v1` `{ attributeKey, isSearchable: false,
  isFilterable: false }`. `search` refreshes its attribute settings, and `price_lists` recomputes
  its surface for the key.
- `custom_fields` cache invalidation for `product` is published (unchanged).

Promotion conditions, price-list rows and feed rules naming the key are neither refused nor
deleted. They become inert under their owners' existing fail-closed rules (research R-21).

## 4. Product content — card list (new)

`GET /api/v1/admin/catalog/products/:id/content` — `catalog:read`.

```jsonc
// 200
{
  "data": {
    "productId": "…",
    "attributeSetId": "…",            // the product's saved set, or null
    "attributes": [                   // page_builder members of that set, by position then key
      {
        "attributeId": "…",           // product_attributes.id
        "key": "buying_guide",
        "label": { "en-US": "Buying guide", "pl-PL": "Poradnik zakupowy" },
        "labelDefault": "Buying guide",
        "position": 3,
        "languages": [                // stored languages only; the client adds the editing languages
          { "language": "en-US", "filled": true, "blocks": 4, "excerpt": "Choosing the right drill…" }
        ]
      }
    ]
  }
}
```

- Reads `summary`, never `content` (research R-3).
- `404 PRODUCT_NOT_FOUND` for an unknown or soft-deleted product.
- `attributes: []` for a product without a set or whose set has no content attribute.
- Not gated on the CMS: it answers with the CMS off (FR-050).

## 5. Product content — one attribute (new)

`GET /api/v1/admin/catalog/products/:id/content/:attributeKey` — `catalog:read`.

```jsonc
// 200
{ "data": { "productId": "…", "attributeKey": "buying_guide", "content": { "languages": { "en-US": { "root": { "props": {} }, "content": [ … ] } } } } }
// content is null when no value is stored
```

- `404 PRODUCT_NOT_FOUND`: unknown or soft-deleted product.
- `404 NOT_FOUND`: unknown key, a key whose type is not `page_builder`, or a content attribute
  that is not a member of the product's **current** set (FR-061 — kept, not offered).

`PUT /api/v1/admin/catalog/products/:id/content/:attributeKey` — `catalog:write`,
`schema: { body: putProductContentRequestSchema }`, route `bodyLimit` =
`PAGE_BUILDER_CONTENT_MAX_BYTES + 65_536`.

```jsonc
// request
{ "content": { "languages": { "en-US": { … }, "pl-PL": { … } } } }   // or { "content": null }
// 200 — the stored, normalised value (empty languages dropped; null when none remained)
{ "data": { "productId": "…", "attributeKey": "buying_guide", "content": { "languages": { "en-US": { … } } } } }
```

| Condition | Answer |
| --- | --- |
| envelope JSON > 1 048 576 UTF-8 bytes | `400 VALIDATION_FAILED`, message `Product content must not exceed 1048576 bytes.`; nothing stored |
| body over the route limit (pathological) | `413 VALIDATION_FAILED` (Fastify) |
| product unknown / soft-deleted | `404 PRODUCT_NOT_FOUND` |
| key unknown, not `page_builder`, or not in the product's current set | `400 ATTRIBUTE_VALUE_REJECTED`, `details: [{ path: 'attributeKey', issue: 'not a Page Builder content attribute of this product's attribute set' }]` (FR-012) |
| every language empty, or `null` | row deleted; `200` with `content: null` (FR-013) |

- Runs as Command `product.content.update` (`objectType: 'product'`, `objectId: <productId>`),
  audit `before`/`after` = `{ attributeKey, languages }`; event `product.content.updated.v1`
  on commit (data-model §5). The product row, its `attribute_values` and every other attribute's
  content are not touched (spec edge case). Last save wins per attribute.

## 6. The ordinary attribute-values path (changed)

`POST /api/v1/admin/catalog/products`, `PATCH /api/v1/admin/catalog/products/:id`,
`PUT /api/v1/catalog/products/by-sku/:sku` (api-key), `catalogProductWritePort.createProduct/updateProduct`:

A key of a `page_builder` attribute anywhere in `attributeValues` →
`400 ATTRIBUTE_VALUE_REJECTED`, `details: [{ path: 'attributeValues.<key>', issue: 'Page Builder content is edited on the product content screen' }]`
— regardless of whether the key was "already stored" (FR-014, FR-042 inbound).

## 7. Integration read (changed)

`GET /api/v1/catalog/attribute-sets/:id` (api-key, `catalog:read`) omits `page_builder` members
(FR-042, "not offered for mapping"). `GET /api/v1/admin/catalog/attribute-sets/:id` keeps them.

## 8. OpenAPI

`backend/test/fixtures/openapi-baseline.json` gains the four new admin paths and the public
`include` query parameter; nothing else moves.
