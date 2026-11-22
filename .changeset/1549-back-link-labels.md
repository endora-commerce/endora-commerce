---
'@endora-commerce/mod-i18n': patch
'@endora-commerce/mod-blog': patch
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-comparisons': patch
'@endora-commerce/mod-document-templates': patch
'@endora-commerce/mod-forms': patch
'@endora-commerce/mod-inventory': patch
'@endora-commerce/mod-megamenu': patch
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-price-lists': patch
'@endora-commerce/mod-product-feeds': patch
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-returns': patch
'@endora-commerce/admin-kit': patch
---

The back link above an admin page title now names the screen it leads to, in the words that screen uses for its own title — *Organizations*, *Price books*, *CMS pages* — instead of *Back to organizations*, *All warehouses*, *Back to list* or a bare *Back* (follow-up of issue #1549). A generic *Back* remains only where a screen was opened from somewhere else and leads back there. The rule is described under `PageHeader` in the admin-kit README.

The back-only translation keys these screens no longer read are removed: `categoryEditor.backToTree` and `postEditor.backToList` (blog), `bulkOperations.detail.back` and `categoryContent.action.back` (catalog), `common.back` (cms, megamenu), `detail.backToList` (comparisons), `entry.back` (forms), `priceBooks.common.backToList` (price lists), `detail.back` (returns), and `inventory.import.back`, `warehouses.editor.backToList`, `organizations.detail.back` and `rfqCreate.back` (core bundle). A deployment that overrides one of them overrides the destination screen's title key instead. `taxIdScope.back` (organizations) and `productContent.action.back` (catalog, now the fallback while the product name loads) keep their keys with new text; `runs.detail.feedFallback` (product feeds) is new.
