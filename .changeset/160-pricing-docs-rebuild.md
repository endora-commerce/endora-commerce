---
'@endora-commerce/mod-price-lists': patch
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-carts': patch
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-product-feeds': patch
'@endora-commerce/mod-quick-order': patch
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-search': patch
---

Documentation only (feature 160, FR-048): the module pages describe how prices are determined with price books.

- `price_lists` ships three pages instead of one: *Price books* (what a book is, base prices, the four resolution steps, the default precedence, variants, where prices appear, the demo's worked examples, permissions, known limitations and a migration note), *The price-book editor* (every admin screen) and *Pricing for developers* (data model, resolver, the batched read path, caching, the price surface, the admin and storefront API, the ports and the conversion from the old model).
- The pages of `catalog`, `carts`, `orders`, `organizations`, `product_feeds`, `quick_order`, `quote_requests` and `search` describe their prices as resolved from price books, with no product-owned price and no fallback. No code changes.
