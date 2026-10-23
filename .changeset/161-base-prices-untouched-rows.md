---
'@endora-commerce/mod-price-lists': patch
---

Base-price writes keep the rows they do not change (feature 161, Checkpoint 6 review). `PUT /api/v1/admin/price-books/base-prices/:productId` (and `PriceBookWritePort.replaceBasePrices` / `replaceProductBaseTiers`) used to delete every row of the currency and insert the new set, so a tier nobody edited was rewritten with a new id; now a row whose variant, window, kind and value are unchanged keeps its id and values, only differing rows are deleted or inserted, and the base book's version moves only when something changed. The admin panel shows a lowest tier above 1 as stored (with a "not orderable below" notice) and a variant's own quantity tiers read-only, sending both back exactly. `price_lists:write` now advises `catalog:read` (`requires`, D-175): the product browser and the variant read need it.
