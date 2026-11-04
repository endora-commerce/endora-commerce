---
'@endora-commerce/mod-search': minor
---

**Breaking — the search document carries one text block per channel language; reindex after upgrading (feature 172).**

The document's `name`, `description`, `localizedNames` and `searchableOptions` fields, and the text values inside `attributes`, are replaced by `texts.<language>` (`name`, `description`, `attributes`, `options`) for every language the channel offers, resolved at that channel and language. A query searches only the shopper's language (`texts.<L>.*`, `sku`, the searchable non-text attributes) and sorts by `texts.<L>.name`.

**Run one full reindex after the upgrade** — the worker's periodic sweep does it on its own, otherwise the admin **Reindex products** action or `pnpm run cli search reindex`. Until an index is reindexed it is queried as before, without the language restriction, and a warning is logged. Index size grows with the number of channel languages.

Option labels are read once per indexing run, and a category-subtree reindex runs one indexing run (performance; no behaviour change). `SearchIndexer.reindexChannel` and `upsertProduct` take an optional trailing `IndexingRun`.
