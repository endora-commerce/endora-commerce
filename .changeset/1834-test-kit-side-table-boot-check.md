---
'@endora-commerce/test-kit': patch
---

`composeTestServer` holds the declared side tables to the database after it opens the ORM, as `composeApp` does (issue #1834, `specs/187-side-table-extensions/`): one catalog query, read-only, refusing the composition with `EntityExtensionDriftError` when a declared side table is missing, unkeyed or does not cascade, and logging an undeclared or unowned one at `warn`.
