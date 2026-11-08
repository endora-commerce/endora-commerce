---
'@endora-commerce/mod-search': patch
---

A search reindex poll that finds the sweep disabled no longer writes a `tenant.escape_hatch` audit row (issue #120). While reindexing was disabled (`search.reindex_interval_minutes` set to `0`), the timer still polled once a minute, and every poll entered the system scope first, which wrote one audit row a minute. The poll now reads `search.reindex_interval_minutes` before it enters the scope. That setting is platform-wide, so the read touches no organization's data. The poll enters the scope only when the sweep is due, or when the once-per-process check of the channel index settings has not run yet. If the setting cannot be read, the poll enters the scope as before.
