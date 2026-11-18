---
'@endora-commerce/admin-shell': patch
'@endora-commerce/mod-i18n': patch
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-inventory': patch
'@endora-commerce/mod-price-lists': patch
'@endora-commerce/mod-custom-fields': patch
'@endora-commerce/mod-dictionaries': patch
'@endora-commerce/mod-product-feeds': patch
'@endora-commerce/mod-seo': patch
'@endora-commerce/mod-assets-library': patch
'@endora-commerce/mod-import-export': patch
---

Page headers are shorter and every page has a heading (issue #1436). Home, Profile, the products list, product create and edit, the inventory and warehouse screens and Pricing settings now draw their title as a real page heading. Page descriptions that repeated the title or described the implementation are removed (categories, bulk operations, new price book, SEO, assets library, dictionary, products list, inventory, warehouses, home, profile); the rest are one short line, in English and Polish. Longer explanations — warehouses, Pricing settings, import/export and category taxonomy revisions — moved behind an ⓘ beside the title.
