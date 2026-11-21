---
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-returns': patch
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-forms': patch
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-comparisons': patch
'@endora-commerce/admin-kit': patch
---

The way back from a detail, create or settings screen is now always the page header's back link above the title (issue #1549). Organization, New organization, Tax ID scope, Change tax ID, Convert to company, Order statuses, Return, Form entry, Category content, Product content and Comparison drew it as an outline Back button among the header actions, an arrow link above the header, or a button at the bottom of the page. Order statuses now goes back to "Orders" rather than a bare "Back". A form entry that is missing or cannot be loaded shows a "Form entry" heading with the same back link. The admin-kit README names `PageHeader` `back` as the one pattern.
