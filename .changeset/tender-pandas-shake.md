---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-assets-library': minor
'@endora-commerce/mod-catalog': major
'@endora-commerce/mod-inventory': minor
'@endora-commerce/mod-product-feeds': major
---

Publish the object store, the availability port and the batched category and
asset reads `product_feeds` reached through a composition root.

`@endora-commerce/contracts` gains four exports and one method, all additive:

- `ObjectStoragePort` (container name `objectStoragePort`, owner
  `assets_library`) with `ObjectStore`, `ObjectStoragePutInput`,
  `ObjectStorageBackendCode` and `AssetByteStream`. A byte store for a module
  that keeps its own objects under its own locator prefix and creates no `Asset`
  row. `getForBackend` is **total** — `legacy` is a URL resolver for pre-013
  rows, not a store, so it is not in the code union and a consumer has no arm to
  probe for.
- `InventoryAvailabilityPort`, the shape `inventoryAvailabilityPort` has always
  answered. The registration carried no type argument, so there was no name to
  import.
- `CatalogCategoryReadPort.expandCategoryProductIds(categoryIds)` — the batched,
  live-narrowed, cycle-tolerant subtree walk. It is **not** a batched
  `listProductIdsInSubtree`: that one is structural by contract and is a
  recursive CTE with no cycle guard.
- `AssetReadPort.resolvePublicUrls(assetIds)` — the stable public URL of each
  live, public asset, and nothing for the rest. Absence is the answer rather
  than an exception, because only the owner can tell a stable URL from an
  expiring signed one.

Breaking, `@endora-commerce/mod-product-feeds`:

- `ProductFeedsBridge` is **removed**. The module resolves the four ports above
  itself; a composition contributes nothing to it beyond deployment values.
- `ProductFeedsModuleOptions.storageAdapters: ArtefactStorageAdapterProvider`
  becomes `objectStorage: ObjectStoragePort`. Pass the container's
  `objectStoragePort` instead of an adapter registry.
- `ArtefactStorageAdapter` and `ArtefactStorageAdapterProvider` are removed from
  `services/artefact-store.js`; `ArtefactStorageBackend` is now
  `ObjectStorageBackendCode` and `ArtefactStorePort.open` returns a
  `node:stream` `Readable` rather than a `NodeJS.ReadableStream`.

Breaking, `@endora-commerce/mod-catalog`:

- `CatalogQueryService.expandCategoryProductIds` is **removed**. The same walk,
  unchanged, is `CatalogCategoryReadService.expandCategoryProductIds`, published
  on `catalogCategoryReadPort`. It is a category read and it now has one home.
