---
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-price-lists': patch
'@endora-commerce/mod-pwa': patch
---

A personal (B2C) Organization's placeholder tax id is no longer shown anywhere outside `organizations` (issue #767). The quote request PDF prints the person as the buyer, with no tax-id line and no placeholder head office. `GET /api/v1/admin/orders/:id` and `GET /api/v1/admin/quote-requests/:id` answer `organization.taxId: null` for it, and the admin order and quote request screens' *Organization* panel then print no tax-id line. The price-book (`…/price-books/targets/organizations`) and push audience (`…/pwa/rule-targets/organizations`) organization pickers answer `taxId: null` for it, so the picker shows no hint. A company Organization's tax id is shown as before.
