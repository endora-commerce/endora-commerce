---
'@endora-commerce/mod-quote-requests': patch
'@endora-commerce/mod-carts': patch
'@endora-commerce/mod-customers': patch
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-inventory': patch
'@endora-commerce/mod-assets-library': patch
'@endora-commerce/mod-i18n': patch
---

Admin screens show translated labels (EN and PL) where they used to show raw codes:

- Quote requests: the status badge in the list and the detail, the status filter and its chips. The status keys are now `rfq.status.<value>` in the `core` catalogue, which replace the unused `rfq.list.statusFilter.<value>` keys. `rfq.list.statusFilter.all` stays.
- Cart detail: the actor, the action and both states in the history feed (`carts.audit.actor.*`, `carts.audit.actionLabel.*`).
- Customer detail: the status of each order, quote request and cart in the history panels, and the address kind.
- Availability notifications: the status badge. Asset detail: the kind of each record that references the asset.

Technical values are gone from the order, quote request and cart screens. The order and quote request detail headers no longer repeat the UUID next to the copyable business ID. The order detail names the delivery and payment methods instead of showing their codes. When the Organization or customer details are missing, it says so instead of printing a UUID (`orderDetail.org.unavailable`, `orderDetail.customer.unavailable`). The carts list starts each row with the cart's owner, linked to the cart, instead of the first eight characters of its UUID. The cart detail header names the owner and the Organization, and an anonymous owner is now labelled "Guest" (`carts.owner.anonymous`). The `carts.column.id` key is removed.
