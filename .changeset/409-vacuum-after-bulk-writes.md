---
'@endora-commerce/mod-catalog': minor
'@endora-commerce/mod-price-lists': minor
---

Issue #409 — after a bulk write, the owning module now runs `VACUUM (ANALYZE)` of the tables it wrote in the background, so the admin's index-only reads (the product list's ordered walk and search count, a price book's lines and searches) have fresh statistics and a visibility map before autovacuum's first pass, which for a write below autovacuum's scale factor may never come.

- **`@endora-commerce/mod-catalog`** adds the BullMQ queue `catalog.table-maintenance` and its consumer: a products import that wrote (`catalogBulkImportPort.importProducts`, not a dry run) asks for `products` and `product_variants`. `import_export` reaches it through that port and names no table.
- **`@endora-commerce/mod-price-lists`** adds `price_lists.table-maintenance`: a price-book row batch (the editor's save and its CSV import), a base-price write (`priceBookWritePort`, the PIM price import) and a book duplicate ask for `price_list_matrix_entries` and `price_list_product_lines`.

Each request is a job delayed by one minute and deduplicated by its table (BullMQ `deduplication` with `keepLastIfActive`), so a burst of writes costs one vacuum per table, and a write while one runs keeps exactly one follow-up. The consumers run one job at a time where the host consumes queues, stop with their module, and log a failure; the write itself never waits for or fails on the request. Without a worker nothing changes — autovacuum remains the fallback. No migration, no new dependency.
