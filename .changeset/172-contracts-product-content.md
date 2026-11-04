---
'@endora-commerce/contracts': minor
---

Product content attributes (`specs/172-product-content-attributes/`), all additive:

- `page_builder` is a new member of `customFieldValueTypeSchema`, `attributeValueTypeSchema` and `apiAttributeTypeSchema`, and `apiAttributeTypeOf('page_builder', …)` answers `page_builder`. `CUSTOM_FIELD_FILTER_OPERATORS.page_builder` is `[]`, and `CUSTOM_FIELD_DEFINITION_ERROR_CODES` gains `value_type_unsupported`. **Connector and integration authors**: an exhaustive `switch` over one of those unions needs a `page_builder` case — skip it. No integration path (the external API, the API-key attribute-set read, imports, exports, feeds) carries a `page_builder` attribute or its content.
- Content shapes: `PAGE_BUILDER_CONTENT_MAX_BYTES` (1 048 576, equal to `CATEGORY_CONTENT_MAX_BYTES`), `productContentEnvelopeSchema`, `putProductContentRequestSchema`, `adminProductContentSchema`, `adminProductContentListSchema`, `adminAttributeUsageSchema` (`{ attributeSetCount, productValueCount, productContentCount }`), `productPageContentAttributeSchema` and `productDetailQuerySchema` (`include=content`).
- `productDetailSchema` gains the optional `contentAttributes`; it is present only when the product page asks for it with `?include=content`.
- `CatalogBulkImportPort` gains `contentAttributeKeys()`.
- `assetReferenceKindSchema` gains `product_content`.
- `AdminZoneNameSchema` gains the zone `product.content.editor`, with `ProductContentEditorZoneProps` (`{ productId, attributeKey, language, data, onChange }`).
