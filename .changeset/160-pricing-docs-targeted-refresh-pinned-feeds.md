---
'@endora-commerce/mod-price-lists': patch
'@endora-commerce/mod-product-feeds': patch
'@endora-commerce/mod-catalog': patch
---

Documentation only (feature 160): the module pages follow the targeted refresh of the price surface and the pinned-feed rules of 2026-10-23.

- `price_lists` — *Pricing for developers* describes the two kinds of mark (a (profile, product) mark in `price_profile_stale_products`, a whole-profile mark), what each write marks, the worker's pass, `namedListPublishability` and the reference a pinned book's percentages are taken off, and the unpriced shape of `resolved-price`; *Price books* says how soon a price change shows in a price-sorted listing. The demo is loaded with `demo seed`, not `demo reset`.
- `product_feeds` — a pinned price book publishes only while it is active or scheduled within its dates, on the feed's channel and for everyone; the feed page warns otherwise, and a run withdraws the published file. A feed is pinned through the admin API.
- `catalog` — product, category and attribute events mark on the price surface the products they concern. No code changes.
