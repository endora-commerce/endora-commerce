---
'@endora-commerce/mod-carts': patch
'@endora-commerce/mod-comparisons': patch
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-inventory': patch
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-price-lists': patch
'@endora-commerce/mod-product-feeds': patch
'@endora-commerce/mod-quick-order': patch
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-blog': patch
'@endora-commerce/mod-projects': patch
'@endora-commerce/mod-tasks': patch
'@endora-commerce/demo-composition': patch
---

Product names, descriptions, alt texts, attachment and packaging-unit names are read at the document's sales channel and language — Channel × language → Channel → Global — through `catalogProductAvailabilityPort.effectiveTexts`, or as the Global string where there is no channel (feature 174). Basket, quote and order snapshots take the effective name when the line is created; a deliberately empty packaging-unit name at the scope keeps the Global name. The back-in-stock e-mail shows the Global name.
