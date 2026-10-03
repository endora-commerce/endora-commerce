---
'@endora-commerce/mod-price-lists': patch
---

Documentation: the price-list engine migration notes now match the migration. It does not strip
the legacy `attributeValues.defaultPrice` / `price` keys and writes no report file; the
structured report comes from `DefaultPriceListMigrator`, the service that performs the same
backfill on demand.
