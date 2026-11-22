---
'@endora-commerce/admin-shell': patch
'@endora-commerce/mod-i18n': patch
---

The *Command hooks* outbox tab is now the admin's standard list page (issue #1749). It pages with the same *Previous* / *Next* footer and rows-per-page choice as every cursor-paged list, which replaces *Load more*. A status change goes back to the first page. Retrying the last row of a page asks for that page again rather than showing an empty one, and focus moves to the results. Retry stays a visible button in each row, and a failed load still offers *Try again*. `listCommandOutbox` now sends an optional `limit`. Removed bundle keys: `platform.commandHooks.outbox.loadMore`, `.loadingMore`, `.end`, `.loading` and `.column.actions`.
