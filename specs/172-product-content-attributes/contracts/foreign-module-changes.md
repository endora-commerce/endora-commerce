# Contract: changes outside `catalog`

Every change below is in the module that owns the code; none adds a lifecycle edge, a port
resolution, a migration or a manifest `dependencies` entry.

## `@endora-commerce/contracts`

| File | Change | Consumer impact |
| --- | --- | --- |
| `custom-fields.ts` | `page_builder` in `customFieldValueTypeSchema`; `CUSTOM_FIELD_FILTER_OPERATORS.page_builder = []`; `'value_type_unsupported'` in `CUSTOM_FIELD_DEFINITION_ERROR_CODES` | an exhaustive `switch`/`Record` over the type must add a case |
| `catalog.ts` | `page_builder` in `attributeValueTypeSchema` and `apiAttributeTypeSchema`; `apiAttributeTypeOf`; `PAGE_BUILDER_CONTENT_MAX_BYTES` (`CATEGORY_CONTENT_MAX_BYTES` aliases it); product-content schemas (data-model §3); `productDetailSchema.contentAttributes?`; `CatalogBulkImportPort.contentAttributeKeys()` | a connector reading `catalogAttributeReadPort` must skip `valueType: 'page_builder'` when offering mappings |
| `assets-library.ts` | `'product_content'` reference kind | — |
| `admin-contributions.ts` | `product.content.editor` + props | — |

## `custom_fields`

- `custom-field-registry.ts`: `pageBuilderValues?: true` on `SupportedEntityMeta`; set on `product`.
- `custom-field-definition-apply.ts`: create/update refuse `page_builder` where the marker is
  absent (`value_type_unsupported`); update refuses a `valueType` change to or from
  `page_builder` (`value_type_locked`) whatever the stored values.
- `custom-field-value.service.ts` `coerce`: explicit `page_builder` → `wrong_type`.
- `custom-field-list-filter.service.ts`: explicit `page_builder` → no predicate.
- Generic admin (`DefinitionForm.tsx` `VALUE_TYPES`): unchanged — pinned by a test.

## `cms`

- New zone contribution `product.content.editor` (admin-surfaces §2). Nothing else.

## `import_export`

- `products.adapter.ts` `importRows`: asks `ports.catalogBulkImport.contentAttributeKeys()` once
  per import; for each record with a non-empty cell under such a column, pushes
  `{ index, reason: 'content attribute "<key>" cannot be imported' }` and continues validating the
  row's other cells. Export unchanged (it carries no attribute column).

## `product_feeds`

- `backend/plugin.ts` `listProductFieldDefinitions`: drops `valueType === 'page_builder'`
  (picker and template-save key check both read it).
- `admin/components/FeedCriteriaPanel.tsx`: drops `type === 'page_builder'` attributes from its
  picker.

## Not changed, by design (structural — research R-6, R-15)

`search`, `quick_order`, `comparisons`, `promotions`, `price_lists`, `seo`, `carts`,
`quote_requests`, `shopping_lists`, `webhooks`: no code change. Each reads either
`products.attribute_values` (which never holds content) or attributes selected by a capability
flag a content attribute cannot carry. Their exclusion tests live in `catalog`'s contract suite
because the subject is what `catalog` hands out.

`pim_connector`, `erp_connector`: exclusivity registries only; nothing to change. Out-of-tree
connectors: see research R-14.
