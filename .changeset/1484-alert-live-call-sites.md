---
'@endora-commerce/admin-shell': patch
'@endora-commerce/mod-assets-library': patch
'@endora-commerce/mod-blog': patch
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-custom-fields': patch
'@endora-commerce/mod-dictionaries': patch
'@endora-commerce/mod-import-export': patch
'@endora-commerce/mod-invoice-ledger': patch
'@endora-commerce/mod-invoices': patch
'@endora-commerce/mod-megamenu': patch
'@endora-commerce/mod-newsletter': patch
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-price-lists': patch
'@endora-commerce/mod-product-feeds': patch
'@endora-commerce/mod-quick-order': patch
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-returns': patch
'@endora-commerce/mod-settings': patch
'@endora-commerce/mod-transactional-emails': patch
---

Banners that appear as the result of an action keep being announced now that the kit's `Alert` no longer interrupts for every variant (issue #1484). A refused or partly rejected action (activating a price book, a stale price-book save, a taxonomy revision, quick-order lines, quote-request lines unavailable on the channel) is announced at once, and so is the shell's notice to an administrator without a role. An import, undo, PDF or save result, a template-preview verdict, a brand contrast warning, a changed refund method, the organization-attribution scope notice and the information notices after an action are announced politely. Static banners present when a page loads, such as the modules screen's degraded-mode warning or a quote request's lapsed validity, are shown but no longer announced as an interruption.
