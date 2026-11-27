---
'@endora-commerce/mod-catalog': minor
'@endora-commerce/contracts': minor
---

`CatalogProductReadPort.findById`, `findByIds`, `findBySku`, `findBySkus` and `listAll` accept `EntityExtensionReadOptions` beside their `CatalogProductLookupOptions`, and `CatalogCategoryReadPort.findById`, `findByIds`, `listAll` (beside `liveOnly`), `findBySlug` and `ancestorsOf` (a trailing `options?`); each returns `WithEntityExtensions<…>` (`specs/187-side-table-extensions/` B2). `include: ['extensions.<moduleId>']` attaches that module's side-table values for `catalog.Product` / `catalog.Category` to the records the lookup answered — after `liveOnly` / `activeOnly`, so a product or category the narrowing excludes never reaches a loader; `ancestorsOf` loads its whole chain at once — through the platform's `entityExtensionReads`. `CatalogProductReadService`'s options gain an optional `extensionReads`, and `CatalogCategoryReadService` an optional second constructor argument. Additive: without `include` every method answers exactly what it answered before.
