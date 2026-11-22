---
'@endora-commerce/mod-i18n': patch
'@endora-commerce/mod-invoices': patch
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-organizations': patch
'@endora-commerce/mod-quick-order': patch
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-returns': patch
---

Shorter admin copy on the order, quote-request, organization, promotion, invoice and return screens (UX audit text-to-cut pass, issue #1567):

- Removed lines that repeated what the screen already shows: the description on the invoices list, the line under the customer's price-negotiation override, the line above the default payment / delivery / address fields, and the description of the organization's Roles section.
- Shortened to one line: the read-only note on price negotiation, the warehouse-precedence hint, the order-confirmation e-mails hint, the parent-organization hint, the empty sales-reps note, the sales-channel hints on order and quote-request creation, the saved-rule copy hint on promotions, and the pending-effects notice on an order.
- Shortened notices: the "carrier not contacted" shipment notice and the "different refund method" warning on a return.

Removed translation keys (EN and PL): `invoices.description`, `defaultPreferences.description` (core bundle), `negotiation.customer.description` (quote requests), `roles.tab.description` (organizations). A theme or overlay that overrode them can drop the override.
