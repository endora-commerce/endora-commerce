---
'@endora-commerce/demo-composition': patch
'@endora-commerce/mod-admin-actions': patch
'@endora-commerce/mod-assets-library': patch
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-cms': patch
'@endora-commerce/mod-comparisons': patch
'@endora-commerce/mod-crm': patch
'@endora-commerce/mod-custom-fields': patch
'@endora-commerce/mod-i18n': patch
'@endora-commerce/mod-import-export': patch
'@endora-commerce/mod-product-feeds': patch
'@endora-commerce/mod-prompt-actions': patch
'@endora-commerce/mod-pwa': patch
'@endora-commerce/mod-quick-order': patch
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-sales-channels': patch
'@endora-commerce/mod-settings': patch
'@endora-commerce/mod-tasks': patch
'@endora-commerce/mod-transactional-emails': patch
---

English page titles, dialog titles, command-palette action labels, settings group names and
documentation page titles now use sentence case, like the module names and sidebar labels
before them. For example, "Quote Requests" becomes "Quote requests", "CMS Pages" becomes
"CMS pages" and the "Quick Order" settings group becomes "Quick order". Polish strings are
unchanged. Product names keep their capitals: Page Builder, Google Analytics, LinkedIn and
Meta among them.

The admin search group labels change the same way: "Quote Requests" becomes "Quote requests"
and "Sales Opportunities" becomes "Sales opportunities". The demo megamenu's English button
label becomes "Quick order". The demo seed does not rewrite a menu it has already created, so an
existing demo database keeps "Quick Order" until it is seeded afresh or the label is edited on
the megamenu screen.

The settings group names are updated in the database the next time the settings manifest
reconciler runs at boot. Nothing has to be migrated.
