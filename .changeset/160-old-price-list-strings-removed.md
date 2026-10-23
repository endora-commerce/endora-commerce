---
'@endora-commerce/mod-i18n': patch
---

The shared admin bundle drops 161 `priceLists.*` strings, in English and Polish, that nothing reads since feature 160 replaced the price-list screens with the price-book editor: the old list, create and detail pages (tabs, products, bulk add, picker), the Application rule builder, the per-currency bracket editor and the linked-lists panel. The `priceLists.displayMode.*` and `priceLists.displayModes.*` strings the display-mode screens use, and `priceLists.loading` and `priceLists.dismiss`, stay.
