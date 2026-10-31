---
'@endora-commerce/mod-carts': patch
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-comparisons': patch
'@endora-commerce/mod-credit-limits': patch
'@endora-commerce/mod-customer-accounts': patch
'@endora-commerce/mod-customers': patch
'@endora-commerce/mod-custom-fields': patch
'@endora-commerce/mod-delivery-methods': patch
'@endora-commerce/mod-dictionaries': patch
'@endora-commerce/mod-document-templates': patch
'@endora-commerce/mod-import-export': patch
'@endora-commerce/mod-inventory': patch
'@endora-commerce/mod-invoice-ledger': patch
'@endora-commerce/mod-invoices': patch
'@endora-commerce/mod-payment-methods': patch
'@endora-commerce/mod-price-lists': patch
'@endora-commerce/mod-product-feeds': patch
'@endora-commerce/mod-promotions': patch
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-sales-channels': patch
'@endora-commerce/mod-taxes': patch
---

The command-palette actions of the commerce modules (`carts`, `catalog`, `comparisons`, `credit_limits`, `customer_accounts`, `customers`, `custom_fields`, `delivery_methods`, `dictionaries`, `document_templates`, `import_export`, `inventory`, `invoice_ledger`, `invoices`, `payment_methods`, `price_lists`, `product_feeds`, `promotions`, `quote_requests`, `sales_channels`, `taxes`) keep only English `keywords` in their manifests. Their Polish search words moved to each module's `i18n/pl.json` under the action's new `keywordsKey`, with an English entry in `i18n/en.json` (issue #573, following #560), and the ones that had been written without diacritics now carry them (`utwórz cennik`, `wyjaśnienie ceny`, `kolejność cen`). A Polish operator finds the same screens by the same words; an English-language admin is no longer offered the Polish ones.
