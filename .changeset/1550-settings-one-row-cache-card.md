---
'@endora-commerce/mod-settings': patch
'@endora-commerce/admin-shell': patch
---

Settings takes one sidebar row instead of three (issue #1550, UX audit SHELL-10). *Settings*, *Groups* and *Cache and search index* are tabs under the one *Settings* entry in *System*; the cache tab is shown only to administrators holding `settings:write`, as its route requires. All three stay reachable from the command palette, and *Clear cache* is now also found by "reindex", "search index" and "translations".

- **Cache and search index** (`/settings/cache`) is one card with three rows — *Clear cache*, *Rebuild search index*, *Reload translations* — each a label, a one-line effect and its button. The namespace list stays under *Clear cache*. No button is filled. The result or error of an action appears beside its button (an `InlineStatus`) rather than as a banner at the top of the page; a failed clear keeps the selection. The page title is *Cache and search index*.
- **Sidebar active state**: a sidebar row now stays highlighted on the screens beneath it unless a more specific row is the one open — `/settings` is highlighted on `/settings/groups` and `/settings/cache`, and not on `/settings/pwa`. A parent row is also highlighted on a detail route that has no row of its own (for example `/inventory/<id>`).
- A pinned *Setting groups* or *Clear cache* sidebar row disappears, because those rows no longer exist; pin *Settings* instead.
- The unused `quoteRequestsTab.expiry.help` string is shortened to one line; the full expiry rules remain in the Quote requests documentation.
