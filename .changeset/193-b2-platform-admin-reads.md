---
'@endora-commerce/platform': minor
---

**Side-table loaders on the admin `?extensions=` read** (`specs/193-admin-form-extensions/` WP-B2, FR-015, ruling D-300.1; 187 R-17).

- `EntityExtensionLoaderEntry` gains an optional `adminReads?: boolean`. A loader registered with `ctx.entityExtensionLoaders([{ host, schema, load, adminReads: true }])` is also served by `schemaExtensionReads` on its host's admin detail and list reads under `extensions.<moduleId>`: called once per response with the records' ids on the route's entity manager, every value parsed with its schema (`EntityExtensionLoaderOutputError` on a refusal), `null` on a record without a value. Without `adminReads`, or while the module is switched off, the key is omitted and the loader is not called; a key no module serves is omitted, never `422`. A loader without `adminReads` behaves exactly as before.
- New loader-registration refusal `loader-and-columns-on-one-host` (`EntityExtensionInvalidError`): a loader with `adminReads: true` from a module that also declares `adminReads` D2 columns on the same host table. `EntityExtensionLoaderRegistryOptions` gains `columnExtensions`, the column declarations it is judged against; `RegisteredEntityExtensionLoader` gains `adminReads`.
- `createSchemaExtensionReads` takes an optional `loaders` (the loader registry); `composeApp` passes it, and the column declarations to the loader registry.
- **Type widening**: `ExtensionAttributeMap`'s per-module value is now `ExtensionJsonValue` (a loader's value, or `null`) instead of a key → value record. Code that indexes into a module's attributes narrows the value first.
