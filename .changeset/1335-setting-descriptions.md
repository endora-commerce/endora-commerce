---
'@endora-commerce/mod-search': patch
'@endora-commerce/mod-inventory': patch
'@endora-commerce/mod-admin-search': patch
---

Corrected setting and module descriptions that no longer matched the code (issue #1335). `search.llm.enabled` now says it needs the `search.llm.embedder_credentials` reference, not the three `embedder.*` settings it replaced. `inventory.low_stock_alert_recipient_email` now says an empty value falls back to the `INVENTORY_LOW_STOCK_RECIPIENT` environment variable, and that no alert is sent when that is unset too. The global search module and its palette action now list projects and tasks among the searchable record types. Both settings now have Polish labels on the Settings screen.
