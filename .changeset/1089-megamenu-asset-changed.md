---
'@endora-commerce/mod-megamenu': patch
---

`megamenu` now follows `assets_library.asset_changed.v1` (`ASSET_CHANGED_EVENT`, issue #1089). A menu payload inlines the URL and label of every asset item and the URL of every icon, and both caches in front of it — the module's Redis entries and the storefront's Data Cache under the `megamenu` tag — kept the previous URL after a replace, a permalink change, a soft delete or an alt-text edit until their lifetime ran out. An announced asset change now drops every `megamenu:v2:*` entry and then revalidates the storefront tag, as a CMS block change already did. A switched-off `megamenu` does not react, and nothing is announced while `assets_library` is absent.
