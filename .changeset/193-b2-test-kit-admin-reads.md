---
'@endora-commerce/test-kit': minor
---

`composeTestServer` passes the side-table loader registry to `schemaExtensionReads` and the column declarations to the loader registry, as `composeApp` does (`specs/193-admin-form-extensions/` FR-015), so an `adminReads` loader is served on a host's `?extensions=` read in a test composition and `loader-and-columns-on-one-host` is refused there too. The column reader it hands the loader registry is the platform's `recordedSchemaExtensions`, so an `adminReads` loader in a composition whose ORM did not record its column declarations is refused, naming the ordering (D-300.23).
