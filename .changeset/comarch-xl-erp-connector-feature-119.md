---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-erp-connector': minor
'@endora-commerce/mod-comarch-xl': minor
'@endora-commerce/mod-invoices': minor
'@endora-commerce/mod-inventory': minor
'@endora-commerce/mod-catalog': patch
---

Comarch ERP XL integration (feature 119): shared ERP connector layer and Comarch XL adapter.

**`@endora-commerce/contracts`** adds `erp-connector.ts` and `comarch-xl.ts` (admin and wire
schemas), `erpConnector` on `ModuleManifestSchema`, and `COMARCH_XL_*` / `ERP_CONNECTOR_*`
error codes.

**`@endora-commerce/mod-erp-connector`** is a new non-deactivatable infra package: mutual
exclusion registry (`erpConnectorRegistryPort`), activation lock entity, and shared job/run
vocabulary. Subpaths: `.`, `./backend`, `./migrations`.

**`@endora-commerce/mod-comarch-xl`** is a new switchable connector package: OpenAPI v0.1.0
REST client, identity mapping, BullMQ detect/sync pipeline, domain apply services, admin UI,
and documented overlay ports. Subpaths: `.`, `./backend`, `./migrations`, `./admin`. Ships
`i18n/` and operator documentation under `docs/`.

**`@endora-commerce/mod-invoices`** extends the module with `erpSaleDocumentWritePort`,
ERP-imported sale document entities, B2B customer routes, and attachment handling for XL
sale documents.

**`@endora-commerce/mod-inventory`** extends `inventoryStockImportPort` for Comarch XL stock
apply wiring (warehouse snapshot import).

**`@endora-commerce/mod-catalog`** honours `createProduct` request `status` instead of
always defaulting new products to `draft`.

Activation is gated by `comarch_xl.enabled` (default off). Only one `erpConnector: true`
module may be operator-active at a time.
