---
'@endora-commerce/mod-credentials': patch
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-quick-order': patch
'@endora-commerce/mod-returns': patch
---

The command-palette actions of `credentials`, `orders`, `organizations`, `quick_order` and `returns` keep only English `keywords` in their manifests; their Polish search words moved to each module's `i18n/pl.json` under the action's new `keywordsKey`, with an English entry in `i18n/en.json` (issue #560). A Polish operator finds the same screens by the same words. The template-variable samples `order.shippingAddressText` (`order_confirmation`) and `statusLabel` (`new_org_registration`) are English in the manifest and carry their Polish form under a `sampleValueKey`.
