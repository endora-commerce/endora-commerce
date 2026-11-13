---
'@endora-commerce/mod-cms': patch
---

The CMS read-through cache is cleared when an embedded asset changes (issue #363). `cms`
subscribes to `ASSET_CHANGED_EVENT`, drops every cached page, block and hook, then asks the
storefront to drop its `cms:page`, `cms:block` and `cms:hook` Data Cache tags, so a replaced
asset's new `?v=` marker is served on the next request instead of after the five-minute cache
window. The CMS learns of the write only through the event, so an `assets_library` that is
absent announces nothing and the CMS is unaffected; a switched-off `cms` does not react.
