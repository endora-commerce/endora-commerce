---
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-i18n': patch
---

The order detail's Overview tab leads with the items (issue #1545, UX audit 2026-11-17 SALES-21).

- **Items** and the totals are the first section, followed by the buyer's note, then one **Customer and addresses** section, then **Status**, the external references and the custom fields. Before, the items came last.
- Organization, customer, delivery address and billing address are one section with a two-column list. They used to be four separate cards.
- The **Payment** tab is now **Payment & invoices** (*Płatności i faktury*), because the order's invoices are listed there.
- The **Comments** tab shows how many comments the order has, and nothing while it has none.

New translation key (orders): `detail.sections.parties`.
