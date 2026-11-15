---
'@endora-commerce/mod-quote-requests': minor
---

On the organization detail screen, the price-negotiation panel is part of the page's one Save (issue #407, `specs/180-one-save-zone-editors/` WP-7). Ticking "Members may propose prices" no longer writes at once. It stages the part "Price negotiation" (`negotiation.partLabel`, English and Polish), and the page's Save writes it through the same `PUT /api/v1/admin/organizations/:id/quote-price-negotiation`. A holder of `customers:read` without `customers:manage` still sees the value and stages nothing. The customer detail screen's panel still saves on change until that screen adopts the page Save.
