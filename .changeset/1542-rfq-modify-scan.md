---
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-i18n': patch
---

The Modify tab of the admin quote request is easier to scan (issue #1542). Its title, which repeated the tab name, is gone: the tab now holds two sections, *Terms* (header note and validity) and *Lines*. The first line column reads "Product" and names each line's product picker, and the reference price and the typed price's difference from it share one cell ("120.00 PLN · −16.67 %"), so a line has seven columns instead of eight. The price-negotiation panels on the organization and customer screens have shorter descriptions and read-only hint.

In the `core` bundle, `rfq.detail.modify.productId` is renamed `rfq.detail.modify.product`, `rfq.detail.modify.title` is removed, and `rfq.detail.modify.referenceDifference`, `rfq.detail.modify.section.terms` and `rfq.detail.modify.section.lines` are new. A deployment that overrides the old keys must rename or drop them.
