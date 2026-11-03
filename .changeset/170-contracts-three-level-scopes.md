---
'@endora-commerce/contracts': minor
---

**Breaking — product values have three scopes, and `null` changes meaning in place (feature 170, FR-116).**

Scoped product values live at Global, Channel or Channel × language; there is no language-only scope. Every scoped write — `scopedValueChangesSchema` (`PUT …/products/:id/scoped-values`), `productScopedWriteInputSchema` (connector port v2), `PATCH …/products/:id/scopes`, `putProductUrlKeysRequestSchema` and the products CSV — uses one write encoding, `scopedWrite` / `toScopedWriteOp`:

| Intent | JSON | CSV cell |
| --- | --- | --- |
| No change | absent, or `""` | empty cell |
| Deliberately empty | `null` | `NULL` |
| Inherit (remove the own value) | `{ "inherit": true }` | `INHERIT` |

**`null` used to mean "use inherited" for scoped product values (feature 163); it now stores a deliberately empty override.** There is no versioned v2 and no refusal period. A caller that sent `null` to remove an override sends `{ "inherit": true }` instead:

```diff
- { "channelKeys": [{ "channelId": "…", "languageCode": "pl-PL", "key": null }] }
+ { "channelKeys": [{ "channelId": "…", "languageCode": "pl-PL", "key": { "inherit": true } }] }
```

`null` on a required field and `INHERIT` at Global are refused (`SCOPED_VALUE_INVALID`). FR-117: this applies to scoped product values only. These fields keep `null` = inherit in this release and are named follow-ups: the per-product stock mode, the per-product fulfilment strategy, the organisation fulfilment / stock-reservation strategy, the organisation credit-inheritance mode, the variant base price per currency, the settings store `globalValue`, and CMS page translation fields (where a blank value inherits).

Other breaking shape changes:

- `name` and `description` of a product are strings (the Global value) on `CatalogProductRecord`, `createProductRequestSchema`, `updateProductRequestSchema` and the summaries; a reader with a channel resolves the effective texts through `catalogProductAvailabilityPort.effectiveTexts`.
- Removed: `ScopedStatusExport`, `scopedStatusColumn`, `parseScopedStatusColumn`, `CatalogBulkImportPort.exportScopedStatuses`, the value-override and scope-context route schemas, the `gallery/channel-roles` schemas, `SeoMetaWritePort` (`seoMetaWritePort`), the `'language'` member of `scopeLevelSchema`, and the per-language `nameTranslations` / `descriptionTranslations` / `altText` maps on gallery items, attachments and packaging units. `updateGalleryItemRequestSchema`, `updateAttachmentRequestSchema` and `updatePackagingUnitRequestSchema` carry collection fields only.
- `ProductUrlKeyWrite` addresses a key by `(channelId, languageCode?)`: `channelId: null` is the Global key, `languageCode: null` the Channel key.
- `catalogProductValueOverrideWritePort` is retired; connectors write through `CatalogProductScopeWritePort.applyScopes` v2 (`productScopedWriteInputSchema`, `fieldPathSchema`, `integrationWritableField`, `ProductScopedWriteResult`).

Added: `product-scope-model` (`PRODUCT_FIELD_SCOPE_SETS`, `ScopeRef`, `scopeRequestSchema`, `scopeFromRequest`), `product-scoped-values` (`ScopedFieldView` with optional `inheritedValue: { value, level: 'G' | 'C' }`, `INHERITED_LEVELS`, `scopedValuesResponseSchema`, `SEO_PRODUCT_META_MAX`), `scoped-write-encoding` (`scopedWrite`, `decodeCsvScopedCell`, `validateScopedWrite`, `scopeVersionTokenSchema`), `SeoProductMetaWritePort` and `seoProductMetaQuerySchema`, the import-profile schemas, `importChannelTargetSchema` / `importChannelTargetListResponseSchema`, `BulkImportReport.truncated` and `BulkImportRowError.code`, and the error codes `SCOPED_VALUE_INVALID`, `FIELD_NOT_AT_SCOPE`, `GLOBAL_ONLY_FIELD`, `VERSION_CONFLICT` and `IMPORT_PROFILE_*`.
