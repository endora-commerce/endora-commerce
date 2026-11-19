---
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-seo': patch
'@endora-commerce/mod-price-lists': patch
'@endora-commerce/mod-i18n': patch
'@endora-commerce/mod-custom-fields': patch
'@endora-commerce/mod-product-feeds': patch
'@endora-commerce/mod-search': patch
'@endora-commerce/mod-import-export': patch
'@endora-commerce/mod-assets-library': patch
---

Shorter copy on the catalog screens (issues #1458 and #1459, UX audit CAT-13 and CAT-14), in English and Polish.

- **Product editor:** the sentences under Gallery, Attachments, Attributes, Categories and SEO that repeated the *Applies immediately*, *Unsaved* and *Global only* badges are gone, and so are the notes under *Minimum order quantity* and the packaging units' minimum. Field notes are one clause; the longer explanation of *Status*, *Publication window* and *Returnable* moved behind an ⓘ beside the label. The confirmations for duplicate, archive and restore, the unsaved-changes question and the inventory and order-rules notes are shorter. The SKU field is labelled *SKU*; the create form says once, under it, that it cannot be changed later. The base-price panel explains what a base price is only while the product has none.
- **Products list:** shorter bulk-edit hints and archive / restore confirmations.
- **Attributes, price lists, warehouses, custom fields, product feeds, import/export, assets:** shorter help texts and notices; the product feed FTP passive mode, the only supported one, is shown as text instead of a disabled one-option select.
- **Settings and SEO:** the descriptions of *Completeness check when switching a product on* and of the LLM search toggle are one or two short sentences, the same English text in the manifest (what the API serves) and in the admin bundle, and so are the two notices above the robots.txt preview.
