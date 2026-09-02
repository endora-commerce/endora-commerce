---
"@endora-commerce/mod-pim-unopim": patch
"@endora-commerce/mod-pim-connector": patch
"@endora-commerce/mod-seo": patch
"@endora-commerce/contracts": patch
---

Fix UnoPim media downloads: a stored media path now resolves to `<baseUrl>/storage/<path>`, the address Laravel's public disk actually serves, instead of `<baseUrl>/media/<path>`, which answered 404 for every file. An absolute `http://` media address is also left as-is rather than being appended to the base URL.

Allow local development instances to fetch UnoPim media over HTTP when the development-only environment override is enabled.

Import UnoPim attribute and option labels per locale, split comma-separated multiselect values, and map boolean source values onto the auto-created yes/no options. `CatalogProductWritePort` now exposes `patchAttributeOption` so a later import can refresh option labels.

The UnoPim import-run detail now includes the recorded per-record issues so the operator can see why a run finished with issues.

Import now reads UnoPim 3 `GET /configurable-products` in addition to `GET /products`, and maps `super_attributes` / `variants` onto Endora configurable products. Previously only the simple-product list was walked, so configurable parents were created as simple products.
