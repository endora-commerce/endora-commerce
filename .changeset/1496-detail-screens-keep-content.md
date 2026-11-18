---
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-invoices': patch
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-promotions': patch
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-customers': patch
'@endora-commerce/mod-i18n': patch
---

The order, invoice, quote request, organization and customer detail screens and the promotion editor no longer replace the whole page with "Loading…" when they re-read their record after an action (issue #1496, UX audit SALES-06). The first load shows a skeleton of the page; a status change, a payment change, a custom-field save, an approve or cancel, a regenerated PDF or a member change keeps the page, its open tab, the scroll position and the focus on screen and marks the content `aria-busy` while it re-reads. A first load that fails now shows its error and a Retry button instead of "not found", and the promotion editor no longer shows an empty form over a promotion it could not read. On the organization screen a member change refused as stale now keeps its explanation on screen after the re-read. New string: `orderDetail.errors.load` (en, pl).
